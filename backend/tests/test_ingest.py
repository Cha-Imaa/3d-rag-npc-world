"""Tests for reading source documents and splitting them into chunks."""

import logging
from pathlib import Path

import pytest
from pypdf import PdfWriter

from app.ingest import (
    MAX_CHUNK_CHARS,
    SOURCES_DIRECTORY,
    Document,
    DocumentPart,
    IngestError,
    chunk_document,
    chunk_knowledge_base,
    chunk_paragraphs,
    read_markdown_file,
    read_pdf_file,
    read_text_file,
    split_paragraphs,
    split_sentences,
)

ALMANAC_PDF = SOURCES_DIRECTORY / "test-collection-one" / "lantern-hill-almanac.pdf"


def make_sentence(number: int, length: int = 100) -> str:
    """Build a sentence of exactly `length` characters that is easy to find again."""
    start = f"Sentence {number} "
    return start + "x" * (length - len(start) - 1) + "."


def write_blank_pdf(path: Path) -> None:
    """Write a one-page PDF with no text, like a scanned page."""
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    with path.open("wb") as file:
        writer.write(file)


def test_split_sentences_keeps_punctuation_and_closing_quotes() -> None:
    text = 'She said "stop." Then it rained! Did it? Yes (mostly.) Done.'

    assert split_sentences(text) == [
        'She said "stop."',
        "Then it rained!",
        "Did it?",
        "Yes (mostly.)",
        "Done.",
    ]


def test_split_paragraphs_joins_wrapped_lines() -> None:
    text = "First line\nwraps here.\n\n  \n\nSecond   paragraph.\n"

    assert split_paragraphs(text) == ["First line wraps here.", "Second paragraph."]


def test_text_file_title_is_its_first_line(tmp_path: Path) -> None:
    path = tmp_path / "notes.txt"
    # The marker some Windows editors add at the start must not end up in the title.
    path.write_text("﻿The Title\n\nSome text\non two lines.", encoding="utf-8")

    document = read_text_file(path)

    assert document.title == "The Title"
    assert document.parts == [
        DocumentPart(page=None, section=None, paragraphs=["The Title", "Some text on two lines."])
    ]


def test_empty_text_file_is_titled_by_file_name_and_has_no_chunks(tmp_path: Path) -> None:
    path = tmp_path / "empty.txt"
    path.write_text("\n\n", encoding="utf-8")

    document = read_text_file(path)

    assert document.title == "empty"
    assert chunk_document(document) == []


def test_markdown_is_split_by_heading_with_its_heading_path(tmp_path: Path) -> None:
    path = tmp_path / "guide.md"
    path.write_text(
        "Intro before any heading.\n\n"
        "# The Guide\n\nOpening words.\n\n"
        "## Spring\n\nRain falls.\n\n"
        "### Frost\n\nCold nights.\n\n"
        "## Empty Section\n\n"
        "## Summer ##\n\nHot days.\n",
        encoding="utf-8",
    )

    document = read_markdown_file(path)

    assert document.title == "The Guide"
    assert [(part.section, part.paragraphs) for part in document.parts] == [
        (None, ["Intro before any heading."]),
        ("The Guide", ["Opening words."]),
        ("The Guide > Spring", ["Rain falls."]),
        ("The Guide > Spring > Frost", ["Cold nights."]),
        # The empty section is skipped, and closing # marks are not part of the heading.
        ("The Guide > Summer", ["Hot days."]),
    ]


def test_markdown_without_a_top_heading_is_titled_by_file_name(tmp_path: Path) -> None:
    path = tmp_path / "loose-notes.md"
    path.write_text("## Only a subheading\n\nText.\n", encoding="utf-8")

    document = read_markdown_file(path)

    assert document.title == "loose-notes"
    assert document.parts[0].section == "Only a subheading"


def test_pdf_keeps_page_numbers_and_joins_wrapped_lines() -> None:
    document = read_pdf_file(ALMANAC_PDF)

    assert document.title == "The Lantern Hill Almanac"
    assert [part.page for part in document.parts] == [1, 2, 3]
    page_one = document.parts[0].paragraphs[0]
    assert "\n" not in page_one
    assert "the Eight Thumb Rule" in page_one


def test_pdf_without_text_has_no_chunks_and_logs_a_warning(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    path = tmp_path / "scanned.pdf"
    write_blank_pdf(path)

    with caplog.at_level(logging.WARNING):
        document = read_pdf_file(path)

    assert document.title == "scanned"
    assert document.parts == []
    assert "no readable text" in caplog.text


def test_unreadable_pdf_raises_ingest_error(tmp_path: Path) -> None:
    path = tmp_path / "broken.pdf"
    path.write_bytes(b"this is not a pdf")

    with pytest.raises(IngestError, match="broken.pdf"):
        read_pdf_file(path)


def test_short_paragraphs_share_a_chunk() -> None:
    assert chunk_paragraphs(["One.", "Two."]) == ["One.\n\nTwo."]


def test_full_chunks_start_with_the_previous_chunks_last_sentence() -> None:
    # Each paragraph is 300 characters, so two fit in a chunk but three do not.
    paragraphs = [
        " ".join(make_sentence(number * 10 + index) for index in range(3)) for number in range(3)
    ]

    chunks = chunk_paragraphs(paragraphs)

    assert len(chunks) == 2
    assert chunks[0] == f"{paragraphs[0]}\n\n{paragraphs[1]}"
    assert chunks[1] == f"{make_sentence(12)} {paragraphs[2]}"


def test_long_paragraphs_are_split_by_sentence_within_the_limit() -> None:
    long_paragraph = " ".join(make_sentence(number) for number in range(20))

    chunks = chunk_paragraphs([long_paragraph])

    assert len(chunks) > 1
    assert all(len(chunk) <= MAX_CHUNK_CHARS for chunk in chunks)
    # Nothing is lost: every sentence appears in some chunk.
    for number in range(20):
        assert any(make_sentence(number) in chunk for chunk in chunks)


def test_long_sentences_are_not_repeated_as_overlap() -> None:
    long_sentence = make_sentence(1, length=400)
    paragraphs = [long_sentence, make_sentence(2, length=300), make_sentence(3, length=300)]

    chunks = chunk_paragraphs(paragraphs)

    assert chunks == [f"{paragraphs[0]}\n\n{paragraphs[1]}", paragraphs[2]]


def test_a_sentence_longer_than_the_limit_is_kept_whole() -> None:
    huge_sentence = make_sentence(1, length=MAX_CHUNK_CHARS + 200)

    assert chunk_paragraphs([huge_sentence]) == [huge_sentence]


def test_chunks_carry_source_details_and_never_cross_parts() -> None:
    document = Document(
        source_file="almanac.pdf",
        title="Almanac",
        parts=[
            DocumentPart(page=1, section=None, paragraphs=["Page one."]),
            DocumentPart(page=2, section=None, paragraphs=["Page two."]),
        ],
    )

    chunks = chunk_document(document)

    assert [(chunk.id, chunk.page, chunk.text) for chunk in chunks] == [
        ("almanac.pdf#1", 1, "Page one."),
        ("almanac.pdf#2", 2, "Page two."),
    ]
    assert all(chunk.title == "Almanac" and chunk.source_file == "almanac.pdf" for chunk in chunks)


def test_knowledge_base_reads_supported_files_in_name_order(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    (tmp_path / "b.txt").write_text("B title\n\nB text.", encoding="utf-8")
    (tmp_path / "a.md").write_text("# A title\n\nA text.", encoding="utf-8")
    (tmp_path / "desktop.ini").write_text("[.ShellClassInfo]", encoding="utf-8")
    (tmp_path / "subfolder").mkdir()

    with caplog.at_level(logging.WARNING):
        chunks = chunk_knowledge_base(tmp_path)

    assert [chunk.id for chunk in chunks] == ["a.md#1", "b.txt#1"]
    assert "Skipping desktop.ini" in caplog.text


def test_missing_knowledge_base_folder_raises_ingest_error(tmp_path: Path) -> None:
    with pytest.raises(IngestError, match="not found"):
        chunk_knowledge_base(tmp_path / "missing")


def test_every_test_collection_chunks_cleanly() -> None:
    folders = sorted(path for path in SOURCES_DIRECTORY.iterdir() if path.is_dir())
    assert len(folders) == 3

    for folder in folders:
        chunks = chunk_knowledge_base(folder)

        assert chunks, folder.name
        assert len({chunk.id for chunk in chunks}) == len(chunks)
        assert all(0 < len(chunk.text) <= MAX_CHUNK_CHARS for chunk in chunks)
