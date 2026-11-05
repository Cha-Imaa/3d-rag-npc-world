/**
 * A message shown in place of the 3D scene when it cannot be displayed.
 * Input: a short title and a plain-language explanation.
 */
export function SceneFallback({ title, message }: { title: string; message: string }) {
  return (
    <div className="scene-fallback" role="alert">
      <h2>{title}</h2>
      <p>{message}</p>
    </div>
  )
}
