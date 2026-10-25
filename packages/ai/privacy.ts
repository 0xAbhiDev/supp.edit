import { freezeSnapshot, type AIProjectContext } from "./context";
import type { AIModel } from "./models";
import type { AIOperation } from "./operations";
import type { ProviderDescriptor } from "./providers";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(",")}}`;
}
export async function contentDigest(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(value)),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export interface CloudRequest {
  operation: AIOperation;
  context: AIProjectContext;
  provider: ProviderDescriptor;
  model: Readonly<AIModel>;
  /** Explicit categories the future transport will send, in addition to the bound source digests. */
  disclosures: readonly ("media" | "transcript-text" | "project-context")[];
}
export interface CloudDisclosure {
  readonly id: string;
  readonly processing: "CLOUD";
  readonly providerName: string;
  readonly endpointOrigin: string;
  readonly operationKind: AIOperation["kind"];
  readonly sourceCount: number;
  readonly categories: readonly string[];
  readonly bindingDigest: string;
}
export interface CloudAuthorization {
  readonly token: string;
}
/** Contract gate for a future native transport. No network or media access exists in this module. */
export class CloudAuthorizationGate {
  private pending = new Map<
    string,
    { disclosure: CloudDisclosure; expires: number }
  >();
  private grants = new Map<string, { digest: string; expires: number }>();
  constructor(private now: () => number = Date.now) {}
  async prepare(request: CloudRequest): Promise<CloudDisclosure> {
    this.validate(request);
    this.prune();
    if (this.pending.size >= 100)
      throw new Error("Too many pending cloud disclosures");
    const disclosure = freezeSnapshot({
      id: crypto.randomUUID(),
      processing: "CLOUD" as const,
      providerName: request.provider.name,
      endpointOrigin:
        request.provider.type === "Local"
          ? ""
          : request.provider.endpointOrigin,
      operationKind: request.operation.kind,
      sourceCount: request.operation.sources.length,
      categories: [...request.disclosures],
      bindingDigest: await contentDigest(request),
    });
    this.pending.set(disclosure.id, {
      disclosure,
      expires: this.now() + 300_000,
    });
    return disclosure;
  }
  /** Call only from an explicit user-confirmation event after displaying the disclosure. */
  confirm(disclosureId: string, confirmed: boolean): CloudAuthorization {
    this.prune();
    const pending = this.pending.get(disclosureId);
    this.pending.delete(disclosureId);
    if (!confirmed || !pending)
      throw new Error(
        "Cloud processing requires a fresh explicit confirmation",
      );
    if (this.grants.size >= 100)
      throw new Error("Too many pending cloud authorizations");
    const token = crypto.randomUUID();
    this.grants.set(token, {
      digest: pending.disclosure.bindingDigest,
      expires: pending.expires,
    });
    return Object.freeze({ token });
  }
  async consume(
    authorization: CloudAuthorization | undefined,
    request: CloudRequest,
  ): Promise<void> {
    this.validate(request);
    this.prune();
    const grant = authorization && this.grants.get(authorization.token);
    if (authorization) this.grants.delete(authorization.token);
    if (
      !grant ||
      grant.digest !== (await contentDigest(request)) ||
      grant.expires <= this.now()
    )
      throw new Error(
        "Cloud authorization is missing, stale, changed, or already used",
      );
  }
  private validate(request: CloudRequest) {
    const { provider, operation, context, model } = request;
    if (provider.type === "Local" || provider.processing !== "CLOUD")
      throw new Error("Cloud authorization requires a remote provider");
    const url = new URL(provider.endpointOrigin);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.origin !== provider.endpointOrigin
    )
      throw new Error(
        "Cloud endpoint must be an HTTPS origin without credentials or parameters",
      );
    if (
      operation.projectId !== context.projectId ||
      operation.contextSnapshotId !== context.snapshotId ||
      operation.revision !== context.revision ||
      operation.providerId !== provider.id ||
      model.providerId !== provider.id ||
      operation.modelId !== model.id ||
      operation.modelVersion !== model.version ||
      model.task !== operation.kind
    )
      throw new Error(
        "Cloud operation binding does not match its context/provider/model",
      );
    if (
      !request.disclosures.length ||
      !request.disclosures.includes("project-context")
    )
      throw new Error("Cloud context disclosure is required");
    if (operation.sources.some((s) => !/^[a-f0-9]{64}$/.test(s.contentDigest)))
      throw new Error("Cloud source requires a verified content digest");
    if (
      operation.sources.some((s) => s.kind === "media") &&
      !request.disclosures.includes("media")
    )
      throw new Error("Media upload disclosure is required");
    if (
      operation.sources.some((s) => s.kind === "transcript") &&
      !request.disclosures.includes("transcript-text")
    )
      throw new Error("Transcript disclosure is required");
  }
  private prune() {
    for (const [id, entry] of this.pending)
      if (entry.expires <= this.now()) this.pending.delete(id);
    for (const [id, entry] of this.grants)
      if (entry.expires <= this.now()) this.grants.delete(id);
  }
}
