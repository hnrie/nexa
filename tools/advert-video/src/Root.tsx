import React from "react";
import { CalculateMetadataFunction, Composition } from "remotion";
import { Advert, Spec } from "./Advert";

// The cut comes in as input props: tools/advert_edit.py writes it (the song
// measured, the takes placed on its beats) and renders through this.
const calculateMetadata: CalculateMetadataFunction<{ spec: Spec }> = ({ props }) => {
  const s = props.spec;
  return { width: s.size[0], height: s.size[1], fps: s.fps, durationInFrames: Math.round((s.span[1] - s.span[0]) * s.fps) };
};

export const RemotionRoot: React.FC = () => (
  <Composition id="Advert" component={Advert} defaultProps={{ spec: null as Spec }} calculateMetadata={calculateMetadata}
    durationInFrames={1} fps={60} width={1920} height={1080} />
);
