"""Ingestion: read an NPC's source documents, split them into chunks, and save a search index.

Build every index with `uv run python -m app.ingest`, or name knowledge bases to build only those.
"""

import argparse
import json
import logging
import re
import sys
from pathlib import Path

import numpy as np
from pydantic import BaseModel
from pypdf import PdfReader
from pypdf.errors import PdfReadError

from app.llm import FakeLlm, LlmError, OpenAiLlm, create_llm
from app.npcs import NpcConfigError, load_npcs
from app.settings import Settings

logger = logging.getLogger(__name__)

DATA_DIRECTORY = Path(__file__).resolve().parents[2] / "data"
SOURCES_DIRECTORY = DATA_DIRECTORY / "sources"
INDEXES_DIRECTORY = DATA_DIRECTORY / "indexes"

# The two files in each index folder, data/indexes/<knowledge_base_id>/.
EMBEDDINGS_FILE_NAME = "embeddings.npy"
CHUNKS_FILE_NAME = "chunks.json"

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


class SearchIndex(BaseModel):
    """One knowledge base's chunks and their embeddings, ready to search.

    Row i of embeddings belongs to chunks[i]. Each row has length 1, or is all zeros for a
    chunk with no words, so a search can score every chunk with one matrix multiplication.
    """

    # NumPy arrays are not a Pydantic type, so allow them here.
    model_config = {"arbitrary_types_allowed": True}

    knowledge_base_id: str
    # The model that made the vectors. A search must embed its question with the same one.
    embedding_model: str
    chunks: list[Chunk]
    embeddings: np.ndarray


def scale_rows_to_length_one(matrix: np.ndarray) -> np.ndarray:
    """Scale each row to length 1, so a dot product between rows is their cosine similarity.

    All-zero rows stay all zeros instead of being divided by zero.
    """
    lengths = np.linalg.norm(matrix, axis=1, keepdims=True)
    lengths[lengths == 0] = 1.0
    return matrix / lengths


def build_index(knowledge_base_id: str, llm: OpenAiLlm | FakeLlm) -> tuple[SearchIndex, int]:
    """Chunk and embed one knowledge base from data/sources.

    Args:
        knowledge_base_id: The folder name in data/sources.
        llm: What makes the embeddings. The real one costs a little credit.

    Returns:
        The index, and the input tokens the embeddings used.

    Raises:
        IngestError: If the folder is missing, a file can't be read, or there is no text.
        LlmError: If the embeddings could not be made.
    """
    chunks = chunk_knowledge_base(SOURCES_DIRECTORY / knowledge_base_id)
    if not chunks:
        # An empty index would let the NPC answer nothing, which is more likely a mistake,
        # such as a folder of scanned PDFs, than something wanted.
        raise IngestError(f"{knowledge_base_id}: no readable text to index")

    embedded = llm.embed_texts([chunk.text for chunk in chunks])
    # float32 halves the file size, and is far more precise than search needs.
    embeddings = scale_rows_to_length_one(np.array(embedded.vectors, dtype=np.float32))

    index = SearchIndex(
        knowledge_base_id=knowledge_base_id,
        embedding_model=llm.embedding_model,
        chunks=chunks,
        embeddings=embeddings,
    )
    return index, embedded.input_tokens


def save_index(index: SearchIndex, indexes_directory: Path = INDEXES_DIRECTORY) -> Path:
    """Write an index to <indexes_directory>/<knowledge_base_id>/, replacing any old one.

    Args:
        index: The index to save.
        indexes_directory: The parent folder. Tests pass a temporary one.

    Returns:
        The index folder.
    """
    folder = indexes_directory / index.knowledge_base_id
    folder.mkdir(parents=True, exist_ok=True)

    np.save(folder / EMBEDDINGS_FILE_NAME, index.embeddings, allow_pickle=False)

    details = {
        "knowledge_base_id": index.knowledge_base_id,
        "embedding_model": index.embedding_model,
        "chunks": [chunk.model_dump() for chunk in index.chunks],
    }
    # Written second, so if writing stops part way, the row count check in load_index
    # will most likely catch the mismatch.
    (folder / CHUNKS_FILE_NAME).write_text(
        json.dumps(details, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    return folder


def load_index(
    knowledge_base_id: str,
    embedding_model: str,
    indexes_directory: Path = INDEXES_DIRECTORY,
) -> SearchIndex:
    """Read a saved index and check it can be searched with the given embedding model.

    Args:
        knowledge_base_id: The index to read.
        embedding_model: The model that will embed questions. It must match the index's.
        indexes_directory: The parent folder. Tests pass a temporary one.

    Returns:
        The index.

    Raises:
        IngestError: If the index is missing, damaged, or made by a different model.
    """
    folder = indexes_directory / knowledge_base_id
    rebuild_hint = f"Rebuild it with: uv run python -m app.ingest {knowledge_base_id}"

    try:
        details = json.loads((folder / CHUNKS_FILE_NAME).read_text(encoding="utf-8"))
        # allow_pickle=False stops a tampered file from running code when it is loaded.
        embeddings = np.load(folder / EMBEDDINGS_FILE_NAME, allow_pickle=False)
        chunks = [Chunk.model_validate(chunk) for chunk in details["chunks"]]
        saved_model = details["embedding_model"]
    except (OSError, ValueError, KeyError, TypeError) as error:
        # ValueError covers bad JSON, a bad .npy file, and a chunk that fails validation.
        message = f"Index {knowledge_base_id} is missing or damaged. {rebuild_hint}"
        raise IngestError(message) from error

    if saved_model != embedding_model:
        # Vectors from different models don't mean the same thing, so search would be noise.
        raise IngestError(
            f"Index {knowledge_base_id} was built with {saved_model}, "
            f"but questions are embedded with {embedding_model}. {rebuild_hint}"
        )

    if embeddings.ndim != 2 or embeddings.shape[0] != len(chunks):
        raise IngestError(f"Index {knowledge_base_id} has mismatched files. {rebuild_hint}")

    return SearchIndex(
        knowledge_base_id=knowledge_base_id,
        embedding_model=saved_model,
        chunks=chunks,
        embeddings=embeddings,
    )


def choose_knowledge_bases(requested: list[str], configured: list[str]) -> list[str]:
    """Pick which knowledge bases to build.

    Args:
        requested: The IDs named on the command line. Empty means all of them.
        configured: The knowledge base IDs in the NPC files.

    Returns:
        The IDs to build.

    Raises:
        IngestError: If a requested ID is not used by any NPC.
    """
    unknown = [name for name in requested if name not in configured]
    if unknown:
        raise IngestError(f"No NPC uses these knowledge bases: {unknown}. Known: {configured}")

    return requested or configured


def main(arguments: list[str] | None = None) -> int:
    """Build search indexes from the command line.

    Args:
        arguments: The command line arguments. None reads the real ones.

    Returns:
        0 if every index was built, or 1 after printing what went wrong.
    """
    parser = argparse.ArgumentParser(
        prog="python -m app.ingest",
        description="Build the search index for each NPC knowledge base, from data/sources.",
    )
    parser.add_argument(
        "knowledge_base_ids",
        nargs="*",
        help="the knowledge bases to build. Leave out to build every one an NPC uses.",
    )
    options = parser.parse_args(arguments)

    # Show the warnings ingestion logs, such as skipped files.
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    try:
        configured = [npc.knowledge_base_id for npc in load_npcs()]
        knowledge_base_ids = choose_knowledge_bases(options.knowledge_base_ids, configured)
        llm = create_llm(Settings())

        for knowledge_base_id in knowledge_base_ids:
            index, input_tokens = build_index(knowledge_base_id, llm)
            folder = save_index(index)
            print(
                f"Built {knowledge_base_id}: {len(index.chunks)} chunks, "
                f"{input_tokens} tokens, model {index.embedding_model}, saved to {folder}"
            )
    except (IngestError, NpcConfigError) as error:
        print(f"Stopped: {error}", file=sys.stderr)
        return 1
    except LlmError as error:
        print(f"Stopped: embeddings failed with {error.code}.", file=sys.stderr)
        if error.code == "llm_not_configured":
            hint = "Set OPENAI_API_KEY in .env, or USE_FAKE_LLM=true for a free fake index."
            print(hint, file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
