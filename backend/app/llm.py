"""LLM access: the only module that talks to OpenAI."""

import hashlib
import html
import math
import re
import time
from collections.abc import Iterator
from typing import Literal, get_args

import httpx2
from openai import AuthenticationError, OpenAI, OpenAIError, RateLimitError
from openai.types.responses import ParsedResponse
from pydantic import BaseModel, ValidationError
from pydantic_core import from_json

from app.settings import Settings

# The visitor watches a thinking indicator, so a stuck call should fail soon.
# The SDK would otherwise wait up to 10 minutes.
REQUEST_TIMEOUT_SECONDS = 30

# One retry covers a brief network problem without keeping the visitor waiting much longer.
MAX_RETRIES = 1

# Limits what one reply can cost. Replies are short, so this is rarely reached.
MAX_OUTPUT_TOKENS = 1000

# The reasons a reply can fail. Each one has a plain-language message in chat.py.
LlmErrorCode = Literal[
    "llm_not_configured",  # The API key is missing, or OpenAI rejected it.
    "llm_out_of_credit",  # The API credit has run out.
    "llm_unavailable",  # OpenAI could not be reached, was busy, or returned an error.
    "llm_bad_reply",  # The model answered, but not with a usable reply.
]

# What a reply is based on. ARCHITECTURE.md explains each kind.
ReplyKind = Literal["casual", "grounded", "no_evidence"]

# Long enough to see the chat panel's thinking state when using the fake LLM.
FAKE_REPLY_DELAY_SECONDS = 1

# How many characters of its JSON reply the fake sends at a time when streaming. Small
# enough that the answer visibly grows over several pieces.
FAKE_STREAM_PIECE_CHARACTERS = 6

# How many texts go in one embedding request. OpenAI accepts up to 2,048, so this keeps
# each request small, and a failure part way through loses little.
EMBEDDING_BATCH_SIZE = 100

# The length of each fake embedding. Enough slots that unrelated words rarely share one.
FAKE_EMBEDDING_DIMENSIONS = 256

# The name saved with an index built by the fake, so it is never searched with real vectors.
FAKE_EMBEDDING_MODEL = "fake-word-counts"

# Finds the id in each <passage id="..."> tag that chat.format_passages writes.
PASSAGE_ID_PATTERN = re.compile(r'<passage id="([^"]*)"')


class LlmError(Exception):
    """A reply could not be produced, so the visitor must see an error and not an answer."""

    def __init__(self, code: LlmErrorCode) -> None:
        super().__init__(code)
        self.code = code


class ChatMessage(BaseModel):
    """One earlier or new message in a conversation."""

    role: Literal["user", "assistant"]
    content: str


class NpcReply(BaseModel):
    """The structured reply the model must return. ARCHITECTURE.md explains each field.

    The model writes the fields in this order. Sources come before the answer, so while a
    reply streams the server already knows what it cites before any answer text is shown.
    """

    kind: ReplyKind
    citation_ids: list[str]
    answer: str
    referral_npc_id: str | None
    referral_reason: str | None


class PartialReply(BaseModel):
    """The fields of a reply the model is still writing. Missing fields are not written yet.

    kind is a plain string because it may be cut off part way, such as "groun".
    """

    kind: str | None = None
    citation_ids: list[str] = []
    answer: str | None = None  # None until the model starts writing the answer.


def read_partial_reply(partial_json: str) -> PartialReply:
    """Read what the model has written so far of its JSON reply.

    Input: the reply text received so far, possibly cut off anywhere.
    Output: the fields readable so far. A string cut off part way, even inside an escape
    such as \\u00e9, gives the part before the cut, so each reading of the answer starts
    with the previous one. Once the answer has started, kind and citation_ids are
    complete, because the model writes them first (see NpcReply). Text that can't be read
    yet, or isn't a JSON object, gives an empty PartialReply.
    """
    try:
        fields = from_json(partial_json, allow_partial="trailing-strings")
    except ValueError:
        return PartialReply()
    if not isinstance(fields, dict):
        return PartialReply()
    try:
        return PartialReply.model_validate(fields)
    except ValidationError:
        return PartialReply()


class AnswerPiece(BaseModel):
    """A new piece of the answer, sent while the model is still writing.

    kind and citation_ids are complete, because the model writes them before the answer,
    so the server can check the sources before showing any of the answer.
    """

    text: str
    kind: str | None
    citation_ids: list[str]


def next_answer_piece(reply_so_far: str, answer_sent: str) -> AnswerPiece | None:
    """Find the part of the answer that hasn't been sent yet.

    Args:
        reply_so_far: The JSON reply text received so far.
        answer_sent: The answer text already sent, joined together.

    Returns:
        The new part of the answer, or None if the answer hasn't grown.
    """
    partial = read_partial_reply(reply_so_far)
    if partial.answer is None or len(partial.answer) <= len(answer_sent):
        return None

    # Each reading starts with the one before (see read_partial_reply), so the new
    # part is whatever comes after the text already sent.
    return AnswerPiece(
        text=partial.answer[len(answer_sent) :],
        kind=partial.kind,
        citation_ids=partial.citation_ids,
    )


class TokenUsage(BaseModel):
    """How many tokens one reply used. Each token is paid for, so this tracks spending."""

    input_tokens: int  # The instructions and messages sent to the model.
    output_tokens: int  # The reply, including any hidden reasoning.


class GeneratedReply(BaseModel):
    """A reply together with what it cost.

    The cost is kept apart from NpcReply, because NpcReply is the shape the model must
    fill in, and the model doesn't report its own token counts.
    """

    reply: NpcReply
    # None when OpenAI did not report usage, so an unknown cost is never logged as zero.
    usage: TokenUsage | None


class EmbeddedTexts(BaseModel):
    """Embeddings for a list of texts, and what they cost."""

    # One vector per text, in the same order as the texts.
    vectors: list[list[float]]
    # Embeddings are paid for by input only. OpenAI always reports this count.
    input_tokens: int


def error_from_openai(error: OpenAIError) -> LlmError:
    """Turn an OpenAI SDK error into the matching LlmError.

    Args:
        error: The error the SDK raised.

    Returns:
        An LlmError whose code says why the call failed.
    """
    if isinstance(error, AuthenticationError):
        return LlmError("llm_not_configured")

    # OpenAI uses the same status for "too many requests" and "no credit left",
    # and only the second one needs the owner to act.
    if isinstance(error, RateLimitError) and error.code == "insufficient_quota":
        return LlmError("llm_out_of_credit")

    return LlmError("llm_unavailable")


def read_token_usage(response: ParsedResponse[NpcReply]) -> TokenUsage | None:
    """Take the token counts from an OpenAI response.

    Args:
        response: The parsed response returned by the SDK.

    Returns:
        The input and output token counts, or None if OpenAI left them out.
    """
    if response.usage is None:
        return None

    return TokenUsage(
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
    )


def finish_reply(response: ParsedResponse[NpcReply]) -> GeneratedReply:
    """Check a finished OpenAI response holds a usable reply.

    Args:
        response: The parsed response returned by the SDK.

    Returns:
        The reply and the tokens it used.

    Raises:
        LlmError: With llm_bad_reply if there is no reply, or its answer is blank.
    """
    reply = response.output_parsed

    # A refusal has no parsed reply, and a blank answer would look like a silent NPC.
    if reply is None or not reply.answer.strip():
        raise LlmError("llm_bad_reply")

    return GeneratedReply(reply=reply, usage=read_token_usage(response))


class OpenAiLlm:
    """Gets NPC replies and embeddings from OpenAI."""

    def __init__(self, settings: Settings, http_client: httpx2.Client | None = None) -> None:
        """Prepare the OpenAI client.

        Args:
            settings: The model settings and the API key.
            http_client: Replaces the network connection. Tests use this to avoid real calls.
        """
        self.settings = settings
        self.client = None
        # Saved with each search index, so an index is only searched with matching vectors.
        self.embedding_model = settings.openai_embedding_model

        # Without a key the server still starts, and only chat fails. See generate_reply.
        if settings.openai_api_key is not None:
            self.client = OpenAI(
                api_key=settings.openai_api_key.get_secret_value(),
                timeout=REQUEST_TIMEOUT_SECONDS,
                max_retries=MAX_RETRIES,
                http_client=http_client,
            )

    def generate_reply(self, instructions: str, messages: list[ChatMessage]) -> GeneratedReply:
        """Ask the model for one structured reply.

        Args:
            instructions: The rules and personality the model must follow.
            messages: The conversation so far, ending with the visitor's new message.

        Returns:
            The model's reply, in the required structure, and the tokens it used.

        Raises:
            LlmError: If no usable reply was produced. Its code says why.
        """
        if self.client is None:
            raise LlmError("llm_not_configured")

        try:
            response = self.client.responses.parse(**self.reply_request(instructions, messages))
        except OpenAIError as error:
            raise error_from_openai(error) from error
        except ValidationError as error:
            # A reply cut off by the token limit is broken JSON, which lands here.
            raise LlmError("llm_bad_reply") from error

        return finish_reply(response)

    def stream_reply(
        self, instructions: str, messages: list[ChatMessage]
    ) -> Iterator[AnswerPiece | GeneratedReply]:
        """Ask the model for one structured reply, and pass on its answer as it is written.

        Args:
            instructions: The rules and personality the model must follow.
            messages: The conversation so far, ending with the visitor's new message.

        Yields:
            An AnswerPiece each time the answer grows, then the finished GeneratedReply,
            the same as generate_reply returns.

        Raises:
            LlmError: If no usable reply was produced, even after some pieces were sent.
        """
        if self.client is None:
            raise LlmError("llm_not_configured")

        try:
            request = self.reply_request(instructions, messages)
            with self.client.responses.stream(**request) as stream:
                answer_sent = ""
                for event in stream:
                    if event.type == "response.output_text.delta":
                        # snapshot is the whole reply text received so far.
                        piece = next_answer_piece(event.snapshot, answer_sent)
                        if piece is not None:
                            answer_sent += piece.text
                            yield piece
                    elif event.type == "response.completed":
                        yield finish_reply(event.response)
                        return
                    elif event.type == "response.incomplete":
                        # Usually the token limit, which cuts the JSON off.
                        raise LlmError("llm_bad_reply")
                    elif event.type in ("response.failed", "error"):
                        raise LlmError("llm_unavailable")
        except OpenAIError as error:
            # Includes an error OpenAI sends part way through the stream.
            raise error_from_openai(error) from error
        except httpx2.HTTPError as error:
            # The connection broke or timed out part way through.
            raise LlmError("llm_unavailable") from error
        except ValidationError as error:
            raise LlmError("llm_bad_reply") from error
        except RuntimeError as error:
            # The SDK raises this when the stream's events arrive out of order.
            raise LlmError("llm_unavailable") from error

        # The stream ended without saying the reply was finished.
        raise LlmError("llm_unavailable")

    def reply_request(self, instructions: str, messages: list[ChatMessage]) -> dict:
        """Build the request settings shared by generate_reply and stream_reply.

        Args:
            instructions: The rules and personality the model must follow.
            messages: The conversation so far, ending with the visitor's new message.

        Returns:
            Keyword arguments for the SDK's responses.parse or responses.stream.
        """
        return {
            "model": self.settings.openai_chat_model,
            "reasoning": {"effort": self.settings.openai_reasoning_effort},
            "instructions": instructions,
            "input": [message.model_dump() for message in messages],
            "text_format": NpcReply,
            "max_output_tokens": MAX_OUTPUT_TOKENS,
            # Conversations are saved locally, so OpenAI has no need to keep a copy.
            "store": False,
        }

    def embed_texts(self, texts: list[str]) -> EmbeddedTexts:
        """Turn texts into embedding vectors, so similar meanings can be found by search.

        Args:
            texts: The texts to embed. None may be blank, because OpenAI rejects blank input.

        Returns:
            One vector per text, in the same order, and the tokens used.

        Raises:
            LlmError: If any batch fails. Its code says why.
        """
        if self.client is None:
            raise LlmError("llm_not_configured")

        vectors = []
        input_tokens = 0

        for start in range(0, len(texts), EMBEDDING_BATCH_SIZE):
            batch = texts[start : start + EMBEDDING_BATCH_SIZE]

            try:
                response = self.client.embeddings.create(
                    model=self.settings.openai_embedding_model,
                    input=batch,
                    encoding_format="float",
                )
            except OpenAIError as error:
                raise error_from_openai(error) from error

            # OpenAI labels each vector with its text's position, so sort by that
            # instead of trusting the order of the list.
            ordered = sorted(response.data, key=lambda embedding: embedding.index)
            vectors.extend(embedding.embedding for embedding in ordered)
            input_tokens += response.usage.prompt_tokens

        return EmbeddedTexts(vectors=vectors, input_tokens=input_tokens)


def fake_embedding(text: str) -> list[float]:
    """Build a repeatable vector from the words in a text, with no network call.

    Each word adds 1 to a slot chosen from a hash of the word, then the vector is scaled
    to length 1. Texts that share words point the same way, so a search with these
    vectors still finds passages that use the question's words. It knows nothing of
    meaning, so "river" and "stream" don't match.

    Args:
        text: The text to embed.

    Returns:
        FAKE_EMBEDDING_DIMENSIONS numbers. All zeros if the text has no words.
    """
    vector = [0.0] * FAKE_EMBEDDING_DIMENSIONS

    for word in re.findall(r"[a-z0-9]+", text.lower()):
        # Python's own hash() changes between runs, so use a fixed hash instead.
        word_hash = hashlib.sha256(word.encode("utf-8")).digest()
        slot = int.from_bytes(word_hash[:4], "big") % FAKE_EMBEDDING_DIMENSIONS
        vector[slot] += 1.0

    length = math.sqrt(sum(value * value for value in vector))
    if length == 0:
        return vector

    return [value / length for value in vector]


def find_passage_ids(messages: list[ChatMessage]) -> list[str]:
    """Read the passage IDs out of the tagged passages the server sends the model.

    Args:
        messages: The messages to look through.

    Returns:
        Each passage ID, in the order sent. Escaped characters are turned back.
    """
    passage_ids = []
    for message in messages:
        for escaped_id in PASSAGE_ID_PATTERN.findall(message.content):
            passage_ids.append(html.unescape(escaped_id))

    return passage_ids


def build_fake_reply(messages: list[ChatMessage]) -> NpcReply:
    """Build the fake's reply, which repeats the visitor's message.

    Args:
        messages: The conversation so far, ending with the visitor's new message.

    Returns:
        A grounded reply citing every passage when the server sent passages, and a
        casual one otherwise. Either way it is labelled as fake.
    """
    visitor_message = messages[-1].content.strip()

    # Cite every passage the server found, so citations can be tried at no cost.
    # The fake can't tell whether they answer the question, but the real model can.
    passage_ids = find_passage_ids(messages[:-1])
    if passage_ids:
        found = f"Found {len(passage_ids)} passages."
        return NpcReply(
            kind="grounded",
            answer=f"[Fake reply] {found} You said: {visitor_message}",
            citation_ids=passage_ids,
            referral_npc_id=None,
            referral_reason=None,
        )

    return NpcReply(
        kind="casual",
        answer=f"[Fake reply] You said: {visitor_message}",
        citation_ids=[],
        referral_npc_id=None,
        referral_reason=None,
    )


class FakeLlm:
    """Stands in for OpenAI, so chat and search can be built and tested with no key and no cost.

    Every reply is labelled as fake, so it can't be mistaken for a real NPC answer.
    Embeddings come from fake_embedding, which matches shared words only.

    To try an error, send one of the LlmErrorCode values as the whole message. Sending
    the same code again straight after succeeds, which is what a retry does.
    """

    def __init__(self, reply_delay_seconds: float = 0) -> None:
        """Prepare the fake.

        Args:
            reply_delay_seconds: How long each reply takes. Tests leave this at zero.
        """
        self.reply_delay_seconds = reply_delay_seconds
        self.last_failed_code = None
        self.embedding_model = FAKE_EMBEDDING_MODEL

    def generate_reply(self, instructions: str, messages: list[ChatMessage]) -> GeneratedReply:
        """Answer like OpenAiLlm.generate_reply, without any network call.

        Args:
            instructions: Accepted to match the real method, and not used.
            messages: The conversation so far, ending with the visitor's new message.

        Returns:
            A reply that repeats the visitor's message, using zero tokens. It is grounded
            and cites every passage when the server sent passages, and casual otherwise.

        Raises:
            LlmError: If the message is an error code that did not just fail.
        """
        time.sleep(self.reply_delay_seconds)

        error_code = self.take_error_to_try(messages)
        if error_code is not None:
            raise LlmError(error_code)

        # Zero is the true count here: the fake spends nothing.
        reply = build_fake_reply(messages)
        return GeneratedReply(reply=reply, usage=TokenUsage(input_tokens=0, output_tokens=0))

    def stream_reply(
        self, instructions: str, messages: list[ChatMessage]
    ) -> Iterator[AnswerPiece | GeneratedReply]:
        """Stream like OpenAiLlm.stream_reply, without any network call.

        The reply is the same as generate_reply's. Its JSON is sent a few characters at a
        time, spread over reply_delay_seconds, and read the same way as a real one.

        Args:
            instructions: Accepted to match the real method, and not used.
            messages: The conversation so far, ending with the visitor's new message.

        Yields:
            An AnswerPiece each time the answer grows, then the finished GeneratedReply.

        Raises:
            LlmError: If the message is an error code that did not just fail. The first
                piece of the answer is sent before the error, so a failure part way
                through a reply can be tried.
        """
        error_code = self.take_error_to_try(messages)
        reply_json = build_fake_reply(messages).model_dump_json()

        # Where each piece ends. The last piece ends with the whole reply.
        step = FAKE_STREAM_PIECE_CHARACTERS
        piece_ends = [*range(step, len(reply_json), step), len(reply_json)]
        pause_seconds = self.reply_delay_seconds / len(piece_ends)

        answer_sent = ""
        for end in piece_ends:
            time.sleep(pause_seconds)
            piece = next_answer_piece(reply_json[:end], answer_sent)
            if piece is None:
                continue

            answer_sent += piece.text
            yield piece
            if error_code is not None:
                raise LlmError(error_code)

        reply = NpcReply.model_validate_json(reply_json)
        yield GeneratedReply(reply=reply, usage=TokenUsage(input_tokens=0, output_tokens=0))

    def take_error_to_try(self, messages: list[ChatMessage]) -> LlmErrorCode | None:
        """Decide whether this message asks the fake to fail.

        Args:
            messages: The conversation so far, ending with the visitor's new message.

        Returns:
            The error code to fail with, or None to reply normally. A code that just
            failed returns None, so a retry succeeds.
        """
        visitor_message = messages[-1].content.strip()

        if visitor_message in get_args(LlmErrorCode) and visitor_message != self.last_failed_code:
            self.last_failed_code = visitor_message
            return visitor_message

        self.last_failed_code = None
        return None

    def embed_texts(self, texts: list[str]) -> EmbeddedTexts:
        """Embed like OpenAiLlm.embed_texts, using word counts instead of a model.

        Args:
            texts: The texts to embed.

        Returns:
            One fake vector per text, in the same order, using zero tokens.
        """
        vectors = [fake_embedding(text) for text in texts]

        return EmbeddedTexts(vectors=vectors, input_tokens=0)


def create_llm(settings: Settings) -> OpenAiLlm | FakeLlm:
    """Choose what answers chat messages.

    Args:
        settings: use_fake_llm picks the fake. The real LLM is the default.

    Returns:
        An object with generate_reply, stream_reply, and embed_texts methods.
    """
    if settings.use_fake_llm:
        return FakeLlm(reply_delay_seconds=FAKE_REPLY_DELAY_SECONDS)

    return OpenAiLlm(settings)
