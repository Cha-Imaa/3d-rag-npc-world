import { useState } from 'react'
import { BackendStatusBadge } from './components/BackendStatusBadge'
import { FirstVisitHint } from './components/FirstVisitHint'
import { rememberHintSeen, shouldShowFirstVisitHint } from './components/hintStorage'
import { SceneErrorBoundary } from './components/SceneErrorBoundary'
import { SceneFallback } from './components/SceneFallback'
import { SceneLoadingOverlay } from './components/SceneLoadingOverlay'
import { SelectedCharacterCard } from './components/SelectedCharacterCard'
import { VillageCanvas } from './scene/VillageCanvas'
import { isWebGLAvailable } from './scene/webgl'

/** Top-level page: the 3D village, with text overlays on top. */
function App() {
  const [canShowScene] = useState(isWebGLAvailable)
  const [isHintVisible, setIsHintVisible] = useState(shouldShowFirstVisitHint)
  const [selectedCharacter, setSelectedCharacter] = useState<number | null>(null)

  /** Hide the hint for good, once the visitor has shown they found the controls. */
  function dismissHint() {
    rememberHintSeen()
    setIsHintVisible(false)
  }

  return (
    <main className="app">
      {canShowScene ? (
        <SceneErrorBoundary>
          <VillageCanvas
            selectedCharacter={selectedCharacter}
            onSelectCharacter={setSelectedCharacter}
            onClearSelection={() => setSelectedCharacter(null)}
            onCameraMove={dismissHint}
          />
          <SceneLoadingOverlay />
          {isHintVisible && <FirstVisitHint onDismiss={dismissHint} />}
          {selectedCharacter !== null && (
            <SelectedCharacterCard
              characterNumber={selectedCharacter + 1}
              onClose={() => setSelectedCharacter(null)}
            />
          )}
        </SceneErrorBoundary>
      ) : (
        <SceneFallback
          title="This browser cannot show the village"
          message="Loreland needs WebGL to draw its 3D scene. Try turning on hardware acceleration in your browser settings, or use an up-to-date version of Chrome, Edge, Firefox, or Safari."
        />
      )}

      <div className="overlay">
        <h1>Loreland</h1>
        <BackendStatusBadge />
      </div>
    </main>
  )
}

export default App
