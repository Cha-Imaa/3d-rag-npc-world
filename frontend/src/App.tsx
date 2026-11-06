import { useCallback, useState } from 'react'
import { BackendStatusBadge } from './components/BackendStatusBadge'
import { FirstVisitHint } from './components/FirstVisitHint'
import { rememberHintSeen, shouldShowFirstVisitHint } from './components/hintStorage'
import { SceneErrorBoundary } from './components/SceneErrorBoundary'
import { SceneFallback } from './components/SceneFallback'
import { SceneLoadingOverlay } from './components/SceneLoadingOverlay'
import { SelectedCharacterCard } from './components/SelectedCharacterCard'
import { TalkPrompt } from './components/TalkPrompt'
import { VillageCanvas } from './scene/VillageCanvas'
import { useTalkingKeys } from './scene/walkingKeys'
import { isWebGLAvailable } from './scene/webgl'

/** Top-level page: the 3D village, with text overlays on top. */
function App() {
  const [canShowScene] = useState(isWebGLAvailable)
  const [isHintVisible, setIsHintVisible] = useState(shouldShowFirstVisitHint)
  const [nearbyCharacter, setNearbyCharacter] = useState<number | null>(null)
  const [talkingCharacter, setTalkingCharacter] = useState<number | null>(null)

  const stopTalking = useCallback(() => setTalkingCharacter(null), [])

  useTalkingKeys({ nearbyCharacter, onTalk: setTalkingCharacter, onStopTalking: stopTalking })

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
            nearbyCharacter={nearbyCharacter}
            talkingCharacter={talkingCharacter}
            onNearbyCharacterChange={setNearbyCharacter}
            onTalk={setTalkingCharacter}
            onFirstWalk={dismissHint}
          />
          <SceneLoadingOverlay />
          {isHintVisible && <FirstVisitHint onDismiss={dismissHint} />}
          {nearbyCharacter !== null && talkingCharacter === null && <TalkPrompt />}
          {talkingCharacter !== null && (
            <SelectedCharacterCard characterNumber={talkingCharacter + 1} onClose={stopTalking} />
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
