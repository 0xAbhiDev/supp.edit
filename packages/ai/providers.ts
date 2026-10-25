import type { JobContext } from "../jobs";
import type { AIProjectContext } from "./context";
import type { OperationKind, OperationMap, ResultMap } from "./operations";

export type ProviderType =
  "Local" | "Remote API" | "Custom / OpenAI-compatible";
export type ProcessingLocation = "LOCAL" | "CLOUD";
export type ProviderDescriptor = {
  id: string;
  name: string;
  version: string;
} & (
  | { type: "Local"; processing: "LOCAL" }
  | { type: "Remote API"; processing: "CLOUD"; endpointOrigin: string }
  | {
      type: "Custom / OpenAI-compatible";
      processing: "CLOUD";
      endpointOrigin: string;
      protocol: "openai-compatible";
    }
);
export interface OperationCapability<K extends OperationKind = OperationKind> {
  kind: K;
  label: string;
  supportsPause: boolean;
  implementation: "deterministic" | "inference";
}
/** Providers receive an immutable allowlisted context, never a mutable Project or editor store. */
export interface AIProvider<K extends OperationKind> {
  readonly descriptor: Readonly<ProviderDescriptor>;
  readonly capabilities: readonly Readonly<OperationCapability<K>>[];
  validate(operation: OperationMap[K], context: AIProjectContext): void;
  run(
    operation: OperationMap[K],
    context: AIProjectContext,
    job: JobContext,
  ): Promise<ResultMap[K]>;
}
export type NativeCredentialReference = string & {
  readonly __nativeCredential: unique symbol;
};
/** Contract only. Implement in the native host with OS credential storage before adding remote execution. */
export interface NativeCredentialStore {
  inspect(
    providerId: string,
  ): Promise<{ configured: boolean; reference?: NativeCredentialReference }>;
  /** Opens a host-owned secure credential flow. The webview never receives the secret. */
  requestSetup(providerId: string): Promise<NativeCredentialReference>;
  remove(reference: NativeCredentialReference): Promise<void>;
}
