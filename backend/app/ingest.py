"""Ingestion: read an NPC's source documents and split them into chunks with source details."""

import logging
import re
from pathlib import Path

from pydantic import BaseModel
from pypdf import PdfReader
from pypdf.errors import PdfReadError

logger = logging.getLogger(__name__)

SOURCES_DIRECTORY = Path(__file__).resolve().parents[2] / "data" / "sources"

SUPPORTED_SUFFIXES = {".txt", ".md", ".pdf"}

# Starting values from ARCHITECTURE.md, not tuned yet.
MAX_CHUNK_CHARS = 800
# The last sentence of one chunk is repeated at the start of the next, so a fact that
# crosses a boundary still appears whole somewhere. Longer sentences are not repeated.
MAX_OVERLAP_CHARS = 150

# The space after . ! or ?, or after one of those followed by a closing quote or bracket.
# Only the space is matched, so splitting keeps the punctuation with its sentence.
SENTENCE_END = re.compile(r"(?:(?<=[.!?])|(?<=[.!?][\"')\]]))\s+")
MARKDOWN_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")


class IngestError(Exception):
    """A source document could not be read."""


class Chunk(BaseModel):
    """One searchable passage, with the details a citation needs to point back to it."""

    id: str
    source_file: str
    title: str
    page: int | None
    section: str | None
    text: str


class DocumentPart(BaseModel):
    """A stretch of a document that shares one location: a PDF page or a Markdown section."""

    page: int | None
    section: str | None
    paragraphs: list[str]


class Document(BaseModel):
    """A parsed source file, before it is split into chunks."""

    source_file: str
    title: str
    parts: list[DocumentPart]


def tidy_whitespace(text: str) -> str:
    """Join wrapped lines and collapse repeated spaces into one."""
    return " ".join(text.split())


def split_paragraphs(text: str) -> list[str]:
    """Split plain text on blank lines, joining the wrapped lines inside each paragraph."""
    paragraphs = [tidy_whitespace(block) for block in re.split(r"\n\s*\n", text)]
    return [paragraph for paragraph in paragraphs if paragraph]


def split_sentences(text: str) -> list[str]:
    """Split text after each full stop, question mark, or exclamation mark."""
    return [sentence for sentence in SENTENCE_END.split(text) if sentence]


def read_text_file(path: Path) -> Document:
    """Read a plain text file. Its first non-empty line is the title.

    Args:
        path: The .txt file.

    Returns:
        The document as one part, with no page or section.
    """
    # utf-8-sig drops the invisible marker some Windows editors put at the start.
    paragraphs = split_paragraphs(path.read_text(encoding="utf-8-sig"))
    title = paragraphs[0] if paragraphs else path.stem

    return Document(
        source_file=path.name,
        title=title,
        parts=[DocumentPart(page=None, section=None, paragraphs=paragraphs)],
    )


def read_markdown_file(path: Path) -> Document:
    """Read a Markdown file, splitting it at each heading.

    Each part's section is its heading path, such as "Spring > Rain". The first
    top-level heading is the title, or the file name when there is none.

    Args:
        path: The .md file.

    Returns:
        The document, with one part per heading that has text under it.
    """
    title = None
    heading_path: list[str] = []
    parts: list[DocumentPart] = []
    lines_in_section: list[str] = []

    def finish_section() -> None:
        """Turn the lines collected under the current heading into a part."""
        paragraphs = split_paragraphs("\n".join(lines_in_section))
        if paragraphs:
            section = " > ".join(heading_path) or None
            parts.append(DocumentPart(page=None, section=section, paragraphs=paragraphs))
        lines_in_section.clear()

    for line in path.read_text(encoding="utf-8-sig").splitlines():
        heading = MARKDOWN_HEADING.match(line)
        if not heading:
            lines_in_section.append(line)
            continue

        finish_section()
        level = len(heading.group(1))
        heading_text = heading.group(2)
        if level == 1 and title is None:
            title = heading_text
        # A level 2 heading replaces any level 2 or deeper heading before it.
        heading_path = heading_path[: level - 1] + [heading_text]

    finish_section()

    return Document(source_file=path.name, title=title or path.stem, parts=parts)


def read_pdf_file(path: Path) -> Document:
    """Read a PDF page by page, keeping page numbers.

    pypdf marks no blank lines between paragraphs, so each page is kept as one
    block of text and split by sentences later. The title comes from the PDF's
    details, then its first line, then the file name.

    Args:
        path: The .pdf file.

    Returns:
        The document, with one part per page that has text.

    Raises:
        IngestError: If the file is not a readable PDF.
    """
    try:
        reader = PdfReader(path)
        page_texts = [page.extract_text() or "" for page in reader.pages]
        metadata_title = reader.metadata.title if reader.metadata else None
    except PdfReadError as error:
        raise IngestError(f"{path.name}: {error}") from error

    parts = []
    for page_number, page_text in enumerate(page_texts, start=1):
        text = tidy_whitespace(page_text)
        if text:
            parts.append(DocumentPart(page=page_number, section=None, paragraphs=[text]))

    if not parts:
        # Scanned PDFs have pictures of text but no text to read.
        logger.warning("%s has no readable text. Scanned PDFs are not supported.", path.name)

    first_line = page_texts[0].strip().split("\n")[0] if page_texts else ""
    title = (metadata_title or "").strip() or first_line.strip() or path.stem

    return Document(source_file=path.name, title=title, parts=parts)


def split_long_paragraph(paragraph: str, max_chars: int) -> list[str]:
    """Group a long paragraph's sentences into pieces of at most max_chars.

    A single sentence longer than max_chars is kept whole, so a piece can be longer.

    Args:
        paragraph: The paragraph to split.
        max_chars: The longest a piece should be.

    Returns:
        The pieces, in order.
    """
    pieces = []
    current = ""
    for sentence in split_sentences(paragraph):
        candidate = f"{current} {sentence}" if current else sentence
        if current and len(candidate) > max_chars:
            pieces.append(current)
            current = sentence
        else:
            current = candidate

    if current:
        pieces.append(current)

    return pieces


def chunk_paragraphs(paragraphs: list[str]) -> list[str]:
    """Pack paragraphs into chunks of at most MAX_CHUNK_CHARS, with a little overlap.

    Whole paragraphs are kept together where they fit. Longer ones are split by
    sentences first, leaving room for the overlap so chunks stay within the limit.

    Args:
        paragraphs: The paragraphs of one page or section, in order.

    Returns:
        The chunk texts, in order.
    """
    pieces = []
    for paragraph in paragraphs:
        if len(paragraph) <= MAX_CHUNK_CHARS:
            pieces.append(paragraph)
        else:
            pieces.extend(split_long_paragraph(paragraph, MAX_CHUNK_CHARS - MAX_OVERLAP_CHARS))

    chunks = []
    current = ""
    for piece in pieces:
        candidate = f"{current}\n\n{piece}" if current else piece
        if not current or len(candidate) <= MAX_CHUNK_CHARS:
            current = candidate
            continue

        # The chunk is full, so close it and start the next with its last sentence.
        chunks.append(current)
        overlap = split_sentences(current)[-1]
        with_overlap = f"{overlap} {piece}"
        fits = len(overlap) <= MAX_OVERLAP_CHARS and len(with_overlap) <= MAX_CHUNK_CHARS
        current = with_overlap if fits else piece

    if current:
        chunks.append(current)

    return chunks


def chunk_document(document: Document) -> list[Chunk]:
    """Split a document into chunks. Chunks never cross a page or section boundary.

    Args:
        document: The parsed document.

    Returns:
        Its chunks, with IDs such as "notes.txt#1" numbered from 1 within the file.
    """
    chunks = []
    for part in document.parts:
        for text in chunk_paragraphs(part.paragraphs):
            chunks.append(
                Chunk(
                    id=f"{document.source_file}#{len(chunks) + 1}",
                    source_file=document.source_file,
                    title=document.title,
                    page=part.page,
                    section=part.section,
                    text=text,
                )
            )

    return chunks


def read_document(path: Path) -> Document:
    """Read one source file with the reader for its type.

    Raises:
        IngestError: If the file type is not supported or the file cannot be read.
    """
    suffix = path.suffix.lower()
    if suffix == ".txt":
        return read_text_file(path)
    if suffix == ".md":
        return read_markdown_file(path)
    if suffix == ".pdf":
        return read_pdf_file(path)

    raise IngestError(f"{path.name}: unsupported file type")


def chunk_knowledge_base(folder: Path) -> list[Chunk]:
    """Read and chunk every supported file in one knowledge base folder.

    Other files, such as the desktop.ini that Windows adds, are skipped with a warning.

    Args:
        folder: The knowledge base folder, such as data/sources/test-collection-one.

    Returns:
        All chunks, in file name order so the result is always the same.

    Raises:
        IngestError: If the folder is missing or a file cannot be read.
    """
    if not folder.is_dir():
        raise IngestError(f"Knowledge base folder not found: {folder}")

    chunks = []
    for path in sorted(folder.iterdir()):
        if not path.is_file():
            continue
        if path.suffix.lower() not in SUPPORTED_SUFFIXES:
            logger.warning("Skipping %s: only .txt, .md, and .pdf files are read.", path.name)
            continue
        chunks.extend(chunk_document(read_document(path)))

    return chunks
