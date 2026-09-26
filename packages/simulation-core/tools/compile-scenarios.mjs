import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const directory = join(root, "src/scenes");
const files = readdirSync(directory).filter((file) => file.endsWith(".yaml")).sort();
if (files.length === 0) throw new Error("No YAML scenes found");
const seen = new Set();
const scenes = files.map((file) => {
  const document = parseDocument(readFileSync(join(directory, file), "utf8"), {
    uniqueKeys: true,
    maxAliasCount: 0,
  });
  if (document.errors.length) throw new Error(`${file}: ${document.errors[0]}`);
  const scene = document.toJS();
  if (!scene || typeof scene.scenario_id !== "string" || seen.has(scene.scenario_id))
    throw new Error(`${file}: missing or duplicate scenario_id`);
  seen.add(scene.scenario_id);
  if (!scene.incident?.escalation || !Array.isArray(scene.incident?.branches))
    throw new Error(`${file}: missing escalation or branches`);
  if (scene.incident.escalation.warning_minutes >= scene.incident.escalation.deadline_minutes)
    throw new Error(`${file}: warning must precede deadline`);
  return scene;
});
writeFileSync(join(root, "src/scenarios.generated.json"),
  JSON.stringify(scenes, null, 2) + "\n");
console.log(`Compiled ${scenes.length} YAML scenes`);
