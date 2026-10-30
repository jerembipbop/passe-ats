import { Composition, registerRoot } from "remotion";
import { SceneAdapt, SceneDocs, SceneDrop, SceneOffer, SceneRobots, SceneScore } from "./scenes.jsx";

// Une composition par plan : le montage (HyperFrames) les enchaîne ensuite
export const SCENES = [
  { id: "robots", component: SceneRobots, seconds: 4 },
  { id: "drop", component: SceneDrop, seconds: 4 },
  { id: "score", component: SceneScore, seconds: 4.5 },
  { id: "offer", component: SceneOffer, seconds: 4 },
  { id: "adapt", component: SceneAdapt, seconds: 4.5 },
  { id: "docs", component: SceneDocs, seconds: 4 },
];

const Root = () =>
  SCENES.map((s) => (
    <Composition key={s.id} id={s.id} component={s.component} durationInFrames={Math.round(s.seconds * 30)} fps={30} width={1080} height={1920} />
  ));

registerRoot(Root);
