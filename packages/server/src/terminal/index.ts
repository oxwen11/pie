import { Layer } from "effect";

import { TerminalManagerLayer as TerminalManagerFromPty } from "./manager";
import { NodePtyLayer } from "./pty-node";

export { TerminalManager } from "./manager";

export const TerminalManagerLayer = TerminalManagerFromPty.pipe(Layer.provide(NodePtyLayer));
