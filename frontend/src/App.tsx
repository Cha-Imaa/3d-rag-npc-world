import { Canvas } from '@react-three/fiber'
import { BackendStatusBadge } from './components/BackendStatusBadge'
import { PlaceholderScene } from './scene/PlaceholderScene'

/** Top-level page: the 3D scene with a small text overlay on top. */
function App() {
  return (
    <main className="app">
      <Canvas camera={{ position: [7, 6, 9], fov: 45 }}>
        <PlaceholderScene />
      </Canvas>

      <div className="overlay">
        <h1>Loreland</h1>
        <BackendStatusBadge />
      </div>
    </main>
  )
}

export default App
