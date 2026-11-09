"""LLM access: the only module that talks to OpenAI."""

import hashlib
import html
import math
import re
import time
from typing import Literal, get_args

import httpx2
from openai import AuthenticationError, OpenAI, OpenAIError, RateLimitError
from openai.types.responses import ParsedResponse
from pydantic import BaseModel, ValidationError

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
    """The structured reply the model must return. ARCHITECTURE.md explains each field."""

    kind: ReplyKind
    answer: str
    citation_ids: list[str]
    referral_npc_id: str | None
    referral_reason: str | None


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
            response = self.client.responses.parse(
                model=self.settings.openai_chat_model,
                reasoning={"effort": self.settings.openai_reasoning_effort},
                instructions=instructions,
                input=[message.model_dump() for message in messages],
                text_format=NpcReply,
                max_output_tokens=MAX_OUTPUT_TOKENS,
                # Conversations are saved locally, so OpenAI has no need to keep a copy.
                store=False,
            )
        except OpenAIError as error:
            raise error_from_openai(error) from error
        except ValidationError as error:
            # A reply cut off by the token limit is broken JSON, which lands here.
            raise LlmError("llm_bad_reply") from error

        reply = response.output_parsed

        # A refusal has no parsed reply, and a blank answer would look like a silent NPC.
        if reply is None or not reply.answer.strip():
            raise LlmError("llm_bad_reply")

        return GeneratedReply(reply=reply, usage=read_token_usage(response))

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
        visitor_message = messages[-1].content.strip()

        if visitor_message in get_args(LlmErrorCode) and visitor_message != self.last_failed_code:
            self.last_failed_code = visitor_message
            raise LlmError(visitor_message)

        self.last_failed_code = None

        # Cite every passage the server found, so citations can be tried at no cost.
        # The fake can't tell whether they answer the question, but the real model can.
        passage_ids = find_passage_ids(messages[:-1])
        if passage_ids:
            found = f"Found {len(passage_ids)} passages."
            reply = NpcReply(
                kind="grounded",
                answer=f"[Fake reply] {found} You said: {visitor_message}",
                citation_ids=passage_ids,
                referral_npc_id=None,
                referral_reason=None,
            )
        else:
            reply = NpcReply(
                kind="casual",
                answer=f"[Fake reply] You said: {visitor_message}",
                citation_ids=[],
                referral_npc_id=None,
                referral_reason=None,
            )

        # Zero is the true count here: the fake spends nothing.
        return GeneratedReply(reply=reply, usage=TokenUsage(input_tokens=0, output_tokens=0))

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
        An object with generate_reply and embed_texts methods.
    """
    if settings.use_fake_llm:
        return FakeLlm(reply_delay_seconds=FAKE_REPLY_DELAY_SECONDS)

    return OpenAiLlm(settings)
