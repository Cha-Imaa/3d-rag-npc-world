import { useEffect, useState } from 'react'
import { BackendStatusBadge } from './components/BackendStatusBadge'
import { ChatPanel } from './components/ChatPanel'
import { FirstVisitHint } from './components/FirstVisitHint'
import { rememberHintSeen, shouldShowFirstVisitHint } from './components/hintStorage'
import { NpcListNotice } from './components/NpcListNotice'
import { SceneErrorBoundary } from './components/SceneErrorBoundary'
import { SceneFallback } from './components/SceneFallback'
import { SceneLoadingOverlay } from './components/SceneLoadingOverlay'
import { TalkPrompt } from './components/TalkPrompt'
import { VillageCanvas } from './scene/VillageCanvas'
import { useTalkingKeys } from './scene/walkingKeys'
import { isWebGLAvailable } from './scene/webgl'
import { selectNearbyNpc, selectTalkingNpc, useVillageStore } from './store'

/** Top-level page: the 3D village, with text overlays on top. */
function App() {
  const [canShowScene] = useState(isWebGLAvailable)
  const [isHintVisible, setIsHintVisible] = useState(shouldShowFirstVisitHint)

  const npcCount = useVillageStore((state) => state.npcs.length)
  const npcListStatus = useVillageStore((state) => state.npcListStatus)
  const nearbyNpc = useVillageStore(selectNearbyNpc)
  const talkingNpc = useVillageStore(selectTalkingNpc)
  const loadNpcs = useVillageStore((state) => state.loadNpcs)
  const startTalking = useVillageStore((state) => state.startTalking)
  const stopTalking = useVillageStore((state) => state.stopTalking)

  useEffect(() => {
    loadNpcs()
  }, [loadNpcs])

  useTalkingKeys({ nearbyNpcId: nearbyNpc?.id ?? null, onTalk: startTalking, onStopTalking: stopTalking })

  /** Hide the hint for good, once the visitor has shown they found the controls. */
  function dismissHint() {
    rememberHintSeen()
    setIsHintVisible(false)
  }

  return (
    <main className="app">
      {canShowScene ? (
        <SceneErrorBoundary>
          <VillageCanvas onFirstWalk={dismissHint} />
          <SceneLoadingOverlay />
          <NpcListNotice status={npcListStatus} npcCount={npcCount} onRetry={loadNpcs} />
          {isHintVisible && <FirstVisitHint onDismiss={dismissHint} />}
          {nearbyNpc && !talkingNpc && <TalkPrompt npcName={nearbyNpc.display_name} />}
          {/* The key gives each NPC a fresh panel, so a draft never carries over to another NPC. */}
          {talkingNpc && <ChatPanel key={talkingNpc.id} npc={talkingNpc} onClose={stopTalking} />}
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
