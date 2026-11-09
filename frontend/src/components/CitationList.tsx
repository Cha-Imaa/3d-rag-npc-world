import type { Citation } from '../api/chat'

/**
 * Name where a passage comes from, such as "Weather Record, page 2".
 * Input: a citation. Output: its title, then its page or section when it has one.
 */
function describeCitation(citation: Citation): string {
  const parts = [citation.title]

  if (citation.page !== null) {
    parts.push(`page ${citation.page}`)
  }
  if (citation.section) {
    parts.push(citation.section)
  }

  return parts.join(', ')
}

/**
 * The sources under an NPC's answer. Each one opens to show the passage it came from,
 * so the visitor can check the answer themselves.
 * Input: the reply's citations. Shows nothing when there are none.
 */
export function CitationList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) {
    return null
  }

  return (
    <div className="citation-list">
      <span className="citation-list-heading">Sources</span>
      {/* details opens and closes without any state, and works with the keyboard. */}
      {citations.map((citation) => (
        <details key={citation.id} className="citation">
          <summary>{describeCitation(citation)}</summary>
          {/* Plain text, never HTML, because documents are untrusted. */}
          <p>{citation.text}</p>
        </details>
      ))}
    </div>
  )
}
