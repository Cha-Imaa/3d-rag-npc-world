"""Tests for reading a reply the model is still writing, piece by piece."""

import json

from app.llm import PartialReply, read_partial_reply

# A complete reply in the order the model writes it. json.dumps escapes é as é and
# the emoji as two halves (🌾), so cuts land inside both kinds of escape.
FULL_REPLY = json.dumps(
    {
        "kind": "grounded",
        "citation_ids": ["guide.txt#1"],
        "answer": 'The well is "old", and café owners use it 🌾.\nAsk me more.',
        "referral_npc_id": None,
        "referral_reason": None,
    }
)


def test_nothing_readable_yet_gives_an_empty_reply() -> None:
    assert read_partial_reply("") == PartialReply()
    assert read_partial_reply("{") == PartialReply()


def test_text_that_is_not_a_json_object_gives_an_empty_reply() -> None:
    assert read_partial_reply("not json") == PartialReply()
    assert read_partial_reply("[1, 2") == PartialReply()


def test_the_answer_is_missing_until_the_model_starts_it() -> None:
    partial = read_partial_reply('{"kind": "grounded", "citation_ids": ["guide.txt#1"], "ans')

    assert partial.answer is None
    assert partial.kind == "grounded"
    assert partial.citation_ids == ["guide.txt#1"]


def test_an_answer_cut_off_part_way_gives_the_part_written_so_far() -> None:
    partial = read_partial_reply('{"kind": "casual", "citation_ids": [], "answer": "Good da')

    assert partial.answer == "Good da"


def test_escapes_are_read_as_the_characters_they_stand_for() -> None:
    partial = read_partial_reply(r'{"answer": "Say \"hi\"\nthen café')

    assert partial.answer == 'Say "hi"\nthen café'


def test_an_escape_cut_off_part_way_is_left_out_until_it_is_complete() -> None:
    assert read_partial_reply('{"answer": "line\\').answer == "line"
    assert read_partial_reply('{"answer": "caf\\u00').answer == "caf"


def test_a_field_of_the_wrong_type_gives_an_empty_reply() -> None:
    assert read_partial_reply('{"answer": 42}') == PartialReply()


def test_every_reading_of_the_answer_starts_with_the_one_before() -> None:
    """Sending only the new part of each reading relies on this."""
    previous_answer = ""
    for cut in range(len(FULL_REPLY) + 1):
        answer = read_partial_reply(FULL_REPLY[:cut]).answer or ""
        assert answer.startswith(previous_answer)
        previous_answer = answer

    assert previous_answer == json.loads(FULL_REPLY)["answer"]
