import { RefinementCtx, z, ZodFirstPartySchemaTypes } from 'zod';
import { oisSchema } from './ois';
import { zodDiscriminatedUnion } from './zod-discriminated-union';

export const templateParametersSchema = z.object({ type: z.string(), name: z.string(), value: z.string() });

export const triggerSchema = z.object({
  endpointId: z.string(),
  endpointName: z.string(),
  oisTitle: z.string(),
});

export const rrpBeaconServerKeeperJobsTriggerSchema = z.object({
  chainIds: z.array(z.string()),
  templateId: z.string(),
  templateParameters: z.array(templateParametersSchema),
  endpointId: z.string(),
  deviationPercentage: z.string(),
  keeperSponsor: z.string(),
  requestSponsor: z.string(),
});

export const triggersSchema = z.object({
  rrp: z.array(triggerSchema),
  http: z.array(triggerSchema).optional(),
  httpSignedData: z.array(triggerSchema),
  rrpBeaconServerKeeperJobs: z.array(rrpBeaconServerKeeperJobsTriggerSchema),
  protoPsp: z.array(z.string()),
});

export const subscriptionSchema = z.object({
  chainId: z.string(),
  airnodeAddress: z.string(),
  templateId: z.string(),
  parameters: z.string(),
  conditions: z.string(),
  relayer: z.string(),
  sponsor: z.string(),
  requester: z.string(),
  fulfillFunctionId: z.string(),
});

export const subscriptionsSchema = z.record(subscriptionSchema);

export const templateSchema = z.object({
  endpointId: z.string(),
  encodedParameters: z.string(),
});

export const templatesSchema = z.record(templateSchema);

export const endpointSchema = z.object({
  oisTitle: z.string(),
  endpointName: z.string(),
});

export const endpointsSchema = z.record(endpointSchema);

export const chainContractsSchema = z.object({
  AirnodeRrp: z.string(),
  RrpBeaconServer: z.string(),
  DapiServer: z.string(),
});

export const chainTypeSchema = z.literal('evm');

export const priorityFeeSchema = z.object({
  value: z.number(),
  unit: z
    .union([
      z.literal('wei'),
      z.literal('kwei'),
      z.literal('mwei'),
      z.literal('gwei'),
      z.literal('szabo'),
      z.literal('finney'),
      z.literal('ether'),
    ])
    .optional(),
});

export const chainOptionsSchema = z.object({
  txType: z.union([z.literal('legacy'), z.literal('eip1559')]),
  baseFeeMultiplier: z.number().int().optional(),
  priorityFee: priorityFeeSchema.optional(),
});

export const providerSchema = z.object({
  url: z.string().url(),
});

export const chainSchema = z.object({
  authorizers: z.array(z.string()),
  blockHistoryLimit: z.number().optional(),
  contracts: chainContractsSchema,
  id: z.string(),
  minConfirmations: z.number().optional(),
  type: chainTypeSchema,
  options: chainOptionsSchema,
  providers: z.record(providerSchema),
  maxConcurrency: z.number(),
});

export const chainsSchema = z.array(chainSchema);

export const heartbeatSchema = z.object({
  enabled: z.boolean(),
  apiKey: z.string().optional(),
  id: z.string().optional(),
  url: z.string().optional(),
});

export const gatewaySchema = z.object({
  enabled: z.boolean(),
  apiKey: z.string().optional(),
  maxConcurrency: z.number().optional(),
});

export const localProviderSchema = z.object({
  type: z.literal('local'),
});

export const awsCloudProviderSchema = z.object({
  type: z.literal('aws'),
  region: z.string(),
  disableConcurrencyReservations: z.boolean(),
});

export const gcpCloudProviderSchema = z.object({
  type: z.literal('gcp'),
  region: z.string(),
  projectId: z.string(),
  disableConcurrencyReservations: z.boolean(),
});

export const cloudProviderSchema = zodDiscriminatedUnion('type', [awsCloudProviderSchema, gcpCloudProviderSchema]);

export const localOrCloudProviderSchema = z.union([localProviderSchema, cloudProviderSchema]);

export const logFormatSchema = z.union([z.literal('json'), z.literal('plain')]);

export const logLevelSchema = z.union([z.literal('DEBUG'), z.literal('INFO'), z.literal('WARN'), z.literal('ERROR')]);

export const nodeSettingsSchema = z.object({
  airnodeWalletMnemonic: z.string(),
  heartbeat: heartbeatSchema,
  httpGateway: gatewaySchema,
  httpSignedDataGateway: gatewaySchema,
  airnodeAddressShort: z.string().optional(),
  stage: z.string(),
  cloudProvider: localOrCloudProviderSchema,
  logFormat: logFormatSchema,
  logLevel: logLevelSchema,
  // TODO: This must match validator version
  nodeVersion: z.string(),
  // TODO: https://api3dao.atlassian.net/browse/AN-556
  skipValidation: z.boolean().optional(),
});

export const baseApiCredentialsSchema = z.object({
  securitySchemeName: z.string(),
  securitySchemeValue: z.string(),
});

export const apiCredentialsSchema = baseApiCredentialsSchema.extend({
  oisTitle: z.string(),
});

export const configSchema = z.object({
  airnodeAddress: z.string(),
  airnodeXpub: z.string(),
  chains: chainsSchema,
  nodeSettings: nodeSettingsSchema,
  triggers: triggersSchema,
  subscriptions: subscriptionsSchema,
  templatesV1: templatesSchema,
  endpoints: endpointsSchema,
  ois: z.array(oisSchema),
  apiCredentials: z.array(apiCredentialsSchema),
});

export type SchemaType<Schema extends ZodFirstPartySchemaTypes> = z.infer<Schema>;
export type ValidatorRefinement<T> = (arg: T, ctx: RefinementCtx) => void;

export type Config = SchemaType<typeof configSchema>;
export type ChainContracts = z.infer<typeof chainContractsSchema>;
export type ChainConfig = z.infer<typeof chainSchema>;
export type Trigger = z.infer<typeof triggerSchema>;
export type Triggers = z.infer<typeof triggersSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;
export type Subscriptions = z.infer<typeof subscriptionsSchema>;
export type Template = z.infer<typeof templateSchema>;
export type Templates = z.infer<typeof templatesSchema>;
export type Endpoint = z.infer<typeof endpointSchema>;
export type Endpoints = z.infer<typeof endpointsSchema>;

export const validateConfig = (config: Config) => configSchema.safeParse(config);
