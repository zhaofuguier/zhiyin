// Presentation state only: no audio, timers, persistence or session side effects.
export type PlayerPanel = 'none' | 'details' | 'together' | 'display';
export interface PlayerPresentation {
  immersive: boolean;
  panel: PlayerPanel;
  fit: 'contain' | 'cover';
}
export type PresentationAction =
  | { type: 'immerse' }
  | { type: 'reveal' }
  | { type: 'panel'; panel: PlayerPanel }
  | { type: 'fit'; fit: PlayerPresentation['fit'] }
  | { type: 'reset' };

export function initialPlayerPresentation(): PlayerPresentation {
  return { immersive: false, panel: 'none', fit: 'contain' };
}

export function updatePlayerPresentation(state: PlayerPresentation, action: PresentationAction): PlayerPresentation {
  switch (action.type) {
    case 'immerse': return { ...state, immersive: true, panel: 'none' };
    case 'reveal': return { ...state, immersive: false };
    case 'panel': return { ...state, immersive: false, panel: action.panel };
    case 'fit': return { ...state, fit: action.fit };
    case 'reset': return initialPlayerPresentation();
  }
}

export function resolveUploadedVisual(input: {
  visualType?: string;
  motionVideoUrl?: string;
  coverImageUrl?: string;
  videoFailed: boolean;
  coverFailed: boolean;
}) {
  const cover = input.coverFailed ? '' : input.coverImageUrl?.trim() || '';
  const video = input.visualType === 'motion' && !input.videoFailed ? input.motionVideoUrl?.trim() || '' : '';
  return { kind: video ? 'video' as const : cover ? 'image' as const : 'empty' as const, video, cover };
}
