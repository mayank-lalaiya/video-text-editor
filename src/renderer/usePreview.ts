import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';
import type { VideoAsset } from '../shared/editor.ts';
import { PreviewPlayer, type PlaybackState } from './preview-player.ts';

const initial: PlaybackState = {
  time: 0,
  playing: false,
  loading: false,
  ready: false,
  error: null,
};

export function usePreview(
  video: VideoAsset | null,
  disabled: boolean,
  editRevision: number,
  initialTime = 0,
  onTime?: (id: string, time: number) => void,
) {
  const element = useRef<HTMLVideoElement>(null);
  const player = useRef<PreviewPlayer | null>(null);
  const [snapshot, setSnapshot] = useState<{
    assetId: string;
    state: PlaybackState;
  } | null>(null);
  const state =
    video && snapshot?.assetId === video.id
      ? snapshot.state
      : { ...initial, time: initialTime };
  const [muted, setMuted] = useState(false);
  const attach = useCallback((node: HTMLVideoElement | null) => {
    element.current = node;
  }, []);
  const resumeTime = useEffectEvent(() => initialTime);
  useEffect(() => {
    if (!video || !element.current) return;
    const active = new PreviewPlayer(
      element.current,
      video,
      (value) => {
        setSnapshot({ assetId: video.id, state: value });
      },
      resumeTime(),
    );
    player.current = active;
    return () => {
      player.current = null;
      active.dispose();
    };
  }, [video]);
  useEffect(() => {
    if (video && snapshot?.assetId === video.id)
      onTime?.(video.id, snapshot.state.time);
  }, [video, snapshot, onTime]);
  useEffect(() => {
    if (disabled) player.current?.stop();
  }, [disabled]);
  useEffect(() => {
    player.current?.pause();
  }, [editRevision]);
  useEffect(() => {
    const space = (event: KeyboardEvent) => {
      if (
        disabled ||
        !video ||
        event.code !== 'Space' ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (event.target instanceof Element &&
          event.target.closest(
            'input,textarea,button,select,a,[contenteditable="true"]',
          ))
      )
        return;
      event.preventDefault();
      player.current?.toggle();
    };
    window.addEventListener('keydown', space);
    return () => window.removeEventListener('keydown', space);
  }, [disabled, video]);
  return {
    ...state,
    element: attach,
    muted,
    pause: () => player.current?.pause(),
    stop: () => player.current?.stop(),
    toggle: () => {
      if (!disabled) player.current?.toggle();
    },
    seek: (time: number) => {
      if (!disabled) player.current?.seek(time);
    },
    toggleMute: () => setMuted((value) => !value),
  };
}
export type PreviewControls = Omit<ReturnType<typeof usePreview>, 'element'>;
