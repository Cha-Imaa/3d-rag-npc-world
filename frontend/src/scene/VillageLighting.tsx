/**
 * Warm light, plus fog that softens the view when zoomed far out.
 * Input: skyColor is used for both the background and the fog, so they blend together.
 */
export function VillageLighting({ skyColor }: { skyColor: string }) {
  return (
    <>
      <color attach="background" args={[skyColor]} />
      <fog attach="fog" args={[skyColor, 24, 60]} />

      {/* Soft fill light, so shaded sides stay warm rather than turning black */}
      <hemisphereLight args={['#fff1dc', '#8a9a5b', 1.3]} />

      {/* The sun. Its shadow area is sized to cover the whole island. */}
      <directionalLight
        castShadow
        color="#ffdcae"
        intensity={2.6}
        position={[9, 13, 6]}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-normalBias={0.03}
      />
    </>
  )
}
