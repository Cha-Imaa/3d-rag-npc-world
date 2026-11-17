"""Tests for the OpenAI module.

These run the real OpenAI SDK against a pretend network connection, so they check how
the SDK actually behaves, while making no paid calls and needing no API key.
"""

import json
from collections.abc import Callable

import httpx2
import pytest

from app.llm import (
    EMBEDDING_BATCH_SIZE,
    AnswerPiece,
    ChatMessage,
    GeneratedReply,
    LlmError,
    NpcReply,
    OpenAiLlm,
    TokenUsage,
)
from app.settings import Settings

MESSAGES = [
    ChatMessage(role="user", content="Hello"),
    ChatMessage(role="assistant", content="Good day."),
    ChatMessage(role="user", content="What do you do here?"),
]

VALID_REPLY = {
    "kind": "casual",
    "answer": "I look after this place.",
    "citation_ids": [],
    "referral_npc_id": None,
    "referral_reason": None,
}

# Token counts in the shape OpenAI reports them. 45 output tokens include 30 for reasoning.
TEST_USAGE = {
    "input_tokens": 120,
    "input_tokens_details": {"cache_write_tokens": 0, "cached_tokens": 0},
    "output_tokens": 45,
    "output_tokens_details": {"reasoning_tokens": 30},
    "total_tokens": 165,
}

# The SDK waits before a retry. This header skips that, so error tests stay fast.
NO_RETRY = {"x-should-retry": "false"}


def response_with_content(content: dict, usage: dict | None = None) -> httpx2.Response:
    """Build a successful OpenAI response holding one piece of message content.

    The usage block is left out unless given, because OpenAI may leave it out too.
    """
    body = {
        "id": "resp_test",
        "object": "response",
        "created_at": 0,
        "model": "test-model",
        "status": "completed",
        "output": [
            {
                "type": "message",
                "id": "msg_test",
                "role": "assistant",
                "status": "completed",
                "content": [content],
            }
        ],
        "parallel_tool_calls": True,
        "tool_choice": "auto",
        "tools": [],
    }
    if usage is not None:
        body["usage"] = usage

    return httpx2.Response(200, json=body)


def response_with_text(text: str, usage: dict | None = None) -> httpx2.Response:
    """Build a successful OpenAI response whose message is the given text."""
    content = {"type": "output_text", "text": text, "annotations": []}

    return response_with_content(content, usage)


def error_response(status: int, code: str | None) -> httpx2.Response:
    """Build an OpenAI error response."""
    body = {"error": {"message": "Test error", "type": "test", "code": code}}
    return httpx2.Response(status, json=body, headers=NO_RETRY)


def make_llm(handler: Callable[[httpx2.Request], httpx2.Response]) -> OpenAiLlm:
    """Build the module with a pretend network that answers with the given function."""
    settings = Settings(
        _env_file=None,
        openai_api_key="test-key",
        openai_chat_model="test-model",
        openai_reasoning_effort="none",
        openai_embedding_model="test-embedding-model",
    )
    http_client = httpx2.Client(transport=httpx2.MockTransport(handler))

    return OpenAiLlm(settings, http_client=http_client)


def code_of_failed_reply(handler: Callable[[httpx2.Request], httpx2.Response]) -> str:
    """Ask for a reply that should fail, and return the error code."""
    with pytest.raises(LlmError) as error_info:
        make_llm(handler).generate_reply("Test instructions", MESSAGES)

    return error_info.value.code


def test_a_valid_reply_is_returned() -> None:
    llm = make_llm(lambda request: response_with_text(json.dumps(VALID_REPLY)))

    generated = llm.generate_reply("Test instructions", MESSAGES)

    assert generated.reply == NpcReply(**VALID_REPLY)


def test_the_token_counts_are_returned_with_the_reply() -> None:
    llm = make_llm(lambda request: response_with_text(json.dumps(VALID_REPLY), usage=TEST_USAGE))

    generated = llm.generate_reply("Test instructions", MESSAGES)

    assert generated.usage == TokenUsage(input_tokens=120, output_tokens=45)


def test_missing_token_counts_stay_unknown_instead_of_zero() -> None:
    llm = make_llm(lambda request: response_with_text(json.dumps(VALID_REPLY)))

    generated = llm.generate_reply("Test instructions", MESSAGES)

    assert generated.usage is None


def test_the_request_carries_the_settings_instructions_and_messages() -> None:
    sent_requests = []

    def record_request(request: httpx2.Request) -> httpx2.Response:
        sent_requests.append(json.loads(request.content))
        return response_with_text(json.dumps(VALID_REPLY))

    make_llm(record_request).generate_reply("Test instructions", MESSAGES)

    body = sent_requests[0]
    assert body["model"] == "test-model"
    assert body["reasoning"] == {"effort": "none"}
    assert body["instructions"] == "Test instructions"
    assert body["input"] == [message.model_dump() for message in MESSAGES]
    assert body["store"] is False


def test_the_request_requires_the_structured_reply() -> None:
    sent_requests = []

    def record_request(request: httpx2.Request) -> httpx2.Response:
        sent_requests.append(json.loads(request.content))
        return response_with_text(json.dumps(VALID_REPLY))

    make_llm(record_request).generate_reply("Test instructions", MESSAGES)

    text_format = sent_requests[0]["text"]["format"]
    assert text_format["type"] == "json_schema"
    assert text_format["strict"] is True
    # Strict mode needs every field listed, so a field with a default would be rejected.
    assert set(text_format["schema"]["required"]) == set(VALID_REPLY)


def test_the_reply_lists_its_sources_before_its_answer() -> None:
    """The model writes fields in schema order, and streaming relies on sources coming first."""
    sent_requests = []

    def record_request(request: httpx2.Request) -> httpx2.Response:
        sent_requests.append(json.loads(request.content))
        return response_with_text(json.dumps(VALID_REPLY))

    make_llm(record_request).generate_reply("Test instructions", MESSAGES)

    field_order = list(sent_requests[0]["text"]["format"]["schema"]["properties"])
    assert field_order == [
        "kind",
        "citation_ids",
        "answer",
        "referral_npc_id",
        "referral_reason",
    ]


def test_a_missing_key_fails_without_any_network_call() -> None:
    llm = OpenAiLlm(Settings(_env_file=None, openai_api_key=None))

    with pytest.raises(LlmError) as error_info:
        llm.generate_reply("Test instructions", MESSAGES)

    assert error_info.value.code == "llm_not_configured"


def test_a_rejected_key_counts_as_not_configured() -> None:
    assert code_of_failed_reply(lambda request: error_response(401, None)) == "llm_not_configured"


def test_running_out_of_credit_has_its_own_code() -> None:
    code = code_of_failed_reply(lambda request: error_response(429, "insufficient_quota"))

    assert code == "llm_out_of_credit"


def test_too_many_requests_does_not_count_as_out_of_credit() -> None:
    code = code_of_failed_reply(lambda request: error_response(429, "rate_limit_exceeded"))

    assert code == "llm_unavailable"


def test_a_server_error_counts_as_unavailable() -> None:
    assert code_of_failed_reply(lambda request: error_response(500, None)) == "llm_unavailable"


def test_a_lost_connection_counts_as_unavailable() -> None:
    def fail_to_connect(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("Test connection failure")

    assert code_of_failed_reply(fail_to_connect) == "llm_unavailable"


def test_a_timeout_counts_as_unavailable() -> None:
    def time_out(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ReadTimeout("Test timeout")

    assert code_of_failed_reply(time_out) == "llm_unavailable"


def test_a_reply_cut_off_part_way_is_rejected() -> None:
    cut_off_text = json.dumps(VALID_REPLY)[:20]

    code = code_of_failed_reply(lambda request: response_with_text(cut_off_text))

    assert code == "llm_bad_reply"


def test_a_reply_with_an_unknown_kind_is_rejected() -> None:
    reply = {**VALID_REPLY, "kind": "made_up"}

    code = code_of_failed_reply(lambda request: response_with_text(json.dumps(reply)))

    assert code == "llm_bad_reply"


def test_a_refusal_is_rejected() -> None:
    refusal = {"type": "refusal", "refusal": "I cannot help with that."}

    code = code_of_failed_reply(lambda request: response_with_content(refusal))

    assert code == "llm_bad_reply"


def test_a_blank_answer_is_rejected() -> None:
    reply = {**VALID_REPLY, "answer": "   "}

    code = code_of_failed_reply(lambda request: response_with_text(json.dumps(reply)))

    assert code == "llm_bad_reply"


def embedding_response(request: httpx2.Request) -> httpx2.Response:
    """Answer an embedding request the way OpenAI does, with vectors listed in reverse.

    Each vector is [position, length of text], so a test can tell which text it belongs
    to. Listing them backwards checks that the code sorts by position. Each text costs
    one token per character.
    """
    texts = json.loads(request.content)["input"]
    data = [
        {"object": "embedding", "index": index, "embedding": [float(index), float(len(text))]}
        for index, text in enumerate(texts)
    ]
    data.reverse()
    total_characters = sum(len(text) for text in texts)
    body = {
        "object": "list",
        "data": data,
        "model": "test-embedding-model",
        "usage": {"prompt_tokens": total_characters, "total_tokens": total_characters},
    }

    return httpx2.Response(200, json=body)


def test_embeddings_come_back_in_the_order_of_the_texts() -> None:
    llm = make_llm(embedding_response)

    embedded = llm.embed_texts(["a", "bb", "ccc"])

    assert embedded.vectors == [[0.0, 1.0], [1.0, 2.0], [2.0, 3.0]]
    assert embedded.input_tokens == 6


def test_the_embedding_request_carries_the_model_and_texts() -> None:
    sent_requests = []

    def record_request(request: httpx2.Request) -> httpx2.Response:
        sent_requests.append(json.loads(request.content))
        return embedding_response(request)

    make_llm(record_request).embed_texts(["first text", "second text"])

    body = sent_requests[0]
    assert body["model"] == "test-embedding-model"
    assert body["input"] == ["first text", "second text"]
    assert body["encoding_format"] == "float"


def test_many_texts_are_sent_in_batches_and_their_tokens_added_up() -> None:
    batch_sizes = []

    def record_batch(request: httpx2.Request) -> httpx2.Response:
        batch_sizes.append(len(json.loads(request.content)["input"]))
        return embedding_response(request)

    texts = ["x"] * (EMBEDDING_BATCH_SIZE + 1)

    embedded = make_llm(record_batch).embed_texts(texts)

    assert batch_sizes == [EMBEDDING_BATCH_SIZE, 1]
    assert len(embedded.vectors) == len(texts)
    assert embedded.input_tokens == len(texts)


def test_no_texts_make_no_request() -> None:
    def fail_if_called(request: httpx2.Request) -> httpx2.Response:
        raise AssertionError("No request should be sent")

    embedded = make_llm(fail_if_called).embed_texts([])

    assert embedded.vectors == []
    assert embedded.input_tokens == 0


def test_embedding_without_a_key_fails_without_any_network_call() -> None:
    llm = OpenAiLlm(Settings(_env_file=None, openai_api_key=None))

    with pytest.raises(LlmError) as error_info:
        llm.embed_texts(["Some text"])

    assert error_info.value.code == "llm_not_configured"


@pytest.mark.parametrize(
    ("status", "openai_code", "expected_code"),
    [
        (401, None, "llm_not_configured"),
        (429, "insufficient_quota", "llm_out_of_credit"),
        (429, "rate_limit_exceeded", "llm_unavailable"),
        (500, None, "llm_unavailable"),
    ],
)
def test_embedding_errors_use_the_same_codes_as_replies(
    status: int, openai_code: str | None, expected_code: str
) -> None:
    llm = make_llm(lambda request: error_response(status, openai_code))

    with pytest.raises(LlmError) as error_info:
        llm.embed_texts(["Some text"])

    assert error_info.value.code == expected_code


# A grounded reply, so streamed pieces have sources to carry.
GROUNDED_REPLY = {
    "kind": "grounded",
    "citation_ids": ["guide.txt#1"],
    "answer": "The well is forty feet deep, and nobody knows who dug it.",
    "referral_npc_id": None,
    "referral_reason": None,
}

# The output message the streamed events build up, before any text arrives.
STREAMED_MESSAGE = {
    "type": "message",
    "id": "msg_test",
    "role": "assistant",
    "status": "in_progress",
    "content": [],
}


def streamed_response_body(status: str, output: list, usage: dict | None = None) -> dict:
    """Build the response object that OpenAI's start and end events carry."""
    body = {
        "id": "resp_test",
        "object": "response",
        "created_at": 0,
        "model": "test-model",
        "status": status,
        "output": output,
        "parallel_tool_calls": True,
        "tool_choice": "auto",
        "tools": [],
    }
    if usage is not None:
        body["usage"] = usage

    return body


def opening_events() -> list[dict]:
    """The events that open a streamed reply, before any text."""
    empty_text = {"type": "output_text", "text": "", "annotations": []}
    return [
        {"type": "response.created", "response": streamed_response_body("in_progress", [])},
        {"type": "response.output_item.added", "output_index": 0, "item": STREAMED_MESSAGE},
        {
            "type": "response.content_part.added",
            "item_id": "msg_test",
            "output_index": 0,
            "content_index": 0,
            "part": empty_text,
        },
    ]


def text_events(text: str, piece_count: int = 4) -> list[dict]:
    """Split the reply text into piece_count text events, the way OpenAI streams it."""
    piece_length = -(-len(text) // piece_count)  # Rounds up, so no text is left over.
    return [
        {
            "type": "response.output_text.delta",
            "item_id": "msg_test",
            "output_index": 0,
            "content_index": 0,
            "delta": text[start : start + piece_length],
            "logprobs": [],
        }
        for start in range(0, len(text), piece_length)
    ]


def closing_events(text: str, usage: dict | None = None) -> list[dict]:
    """The events that finish a successful streamed reply."""
    finished_text = {"type": "output_text", "text": text, "annotations": []}
    finished_message = {**STREAMED_MESSAGE, "status": "completed", "content": [finished_text]}
    return [
        {
            "type": "response.output_text.done",
            "item_id": "msg_test",
            "output_index": 0,
            "content_index": 0,
            "text": text,
            "logprobs": [],
        },
        {"type": "response.output_item.done", "output_index": 0, "item": finished_message},
        {
            "type": "response.completed",
            "response": streamed_response_body("completed", [finished_message], usage),
        },
    ]


def successful_stream_events(reply: dict, usage: dict | None = None) -> list[dict]:
    """All the events of a streamed reply that finishes normally."""
    text = json.dumps(reply)
    return opening_events() + text_events(text) + closing_events(text, usage)


def stream_body(events: list[dict]) -> bytes:
    """Write events as server-sent events, the format OpenAI streams in."""
    lines = []
    for number, event in enumerate(events):
        numbered_event = {**event, "sequence_number": number}
        lines.append(f"event: {event['type']}\ndata: {json.dumps(numbered_event)}\n\n")

    return "".join(lines).encode()


def stream_response(events: list[dict]) -> httpx2.Response:
    """Build a successful streamed OpenAI response that sends the given events."""
    headers = {"content-type": "text/event-stream"}
    return httpx2.Response(200, content=stream_body(events), headers=headers)


def events_cut_off_with(last_event: dict | None) -> list[dict]:
    """The events of a reply that stops part way through its text, then sends last_event."""
    text = json.dumps(GROUNDED_REPLY)
    events = opening_events() + text_events(text)[:2]
    if last_event is not None:
        events.append(last_event)

    return events


def code_of_failed_stream(handler: Callable[[httpx2.Request], httpx2.Response]) -> str:
    """Stream a reply that should fail, and return the error code."""
    with pytest.raises(LlmError) as error_info:
        list(make_llm(handler).stream_reply("Test instructions", MESSAGES))

    return error_info.value.code


def test_a_streamed_reply_arrives_in_pieces_and_ends_with_the_whole_reply() -> None:
    events = successful_stream_events(GROUNDED_REPLY, usage=TEST_USAGE)
    llm = make_llm(lambda request: stream_response(events))

    *pieces, final = llm.stream_reply("Test instructions", MESSAGES)

    assert len(pieces) > 1
    assert all(isinstance(piece, AnswerPiece) for piece in pieces)
    assert "".join(piece.text for piece in pieces) == GROUNDED_REPLY["answer"]
    assert final == GeneratedReply(
        reply=NpcReply(**GROUNDED_REPLY),
        usage=TokenUsage(input_tokens=120, output_tokens=45),
    )


def test_each_streamed_piece_carries_the_sources_chosen_before_the_answer() -> None:
    events = successful_stream_events(GROUNDED_REPLY)
    llm = make_llm(lambda request: stream_response(events))

    *pieces, _final = llm.stream_reply("Test instructions", MESSAGES)

    for piece in pieces:
        assert piece.kind == "grounded"
        assert piece.citation_ids == ["guide.txt#1"]


def test_the_streamed_request_has_the_same_settings_as_a_normal_one() -> None:
    sent_requests = []

    def record_normal_request(request: httpx2.Request) -> httpx2.Response:
        sent_requests.append(json.loads(request.content))
        return response_with_text(json.dumps(VALID_REPLY))

    def record_streamed_request(request: httpx2.Request) -> httpx2.Response:
        sent_requests.append(json.loads(request.content))
        return stream_response(successful_stream_events(VALID_REPLY))

    make_llm(record_normal_request).generate_reply("Test instructions", MESSAGES)
    list(make_llm(record_streamed_request).stream_reply("Test instructions", MESSAGES))

    normal_request, streamed_request = sent_requests
    assert streamed_request.pop("stream") is True
    assert streamed_request == normal_request


def test_streaming_without_a_key_fails_without_any_network_call() -> None:
    llm = OpenAiLlm(Settings(_env_file=None, openai_api_key=None))

    with pytest.raises(LlmError) as error_info:
        list(llm.stream_reply("Test instructions", MESSAGES))

    assert error_info.value.code == "llm_not_configured"


@pytest.mark.parametrize(
    ("status", "openai_code", "expected_code"),
    [
        (401, None, "llm_not_configured"),
        (429, "insufficient_quota", "llm_out_of_credit"),
        (500, None, "llm_unavailable"),
    ],
)
def test_a_stream_that_fails_to_open_uses_the_same_codes(
    status: int, openai_code: str | None, expected_code: str
) -> None:
    code = code_of_failed_stream(lambda request: error_response(status, openai_code))

    assert code == expected_code


@pytest.mark.parametrize(
    "last_event",
    [
        # An error event, as OpenAI sends it.
        {"type": "error", "code": "server_error", "message": "Test error", "param": None},
        # An error event in the older shape, which the SDK raises as an exception.
        {"type": "error", "error": {"message": "Test error", "type": "server_error"}},
        # The response failed on OpenAI's side.
        {"type": "response.failed", "response": streamed_response_body("failed", [])},
        # The stream simply stops.
        None,
    ],
)
def test_a_stream_that_breaks_part_way_counts_as_unavailable(last_event: dict | None) -> None:
    events = events_cut_off_with(last_event)

    assert code_of_failed_stream(lambda request: stream_response(events)) == "llm_unavailable"


def test_a_connection_lost_part_way_counts_as_unavailable() -> None:
    first_events = stream_body(events_cut_off_with(None))

    def body_then_lost_connection():
        """Send the first events, then lose the connection."""
        yield first_events
        raise httpx2.ReadError("Connection lost")

    def handler(request: httpx2.Request) -> httpx2.Response:
        headers = {"content-type": "text/event-stream"}
        return httpx2.Response(200, content=body_then_lost_connection(), headers=headers)

    assert code_of_failed_stream(handler) == "llm_unavailable"


def test_a_streamed_reply_cut_off_by_the_token_limit_is_rejected() -> None:
    incomplete = {
        "type": "response.incomplete",
        "response": streamed_response_body("incomplete", []),
    }
    events = events_cut_off_with(incomplete)

    assert code_of_failed_stream(lambda request: stream_response(events)) == "llm_bad_reply"


def test_a_streamed_blank_answer_is_rejected() -> None:
    events = successful_stream_events({**VALID_REPLY, "answer": "  "})

    assert code_of_failed_stream(lambda request: stream_response(events)) == "llm_bad_reply"
