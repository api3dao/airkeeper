import * as airnodeValidator from '@api3/airnode-validator';
import * as airnodeOis from '@api3/ois';
import { z, ZodFirstPartySchemaTypes } from 'zod';

export const templateParametersSchema = z.object({ type: z.string(), name: z.string(), value: z.string() });

export const rrpBeaconServerKeeperJobsTriggerSchema = z.object({
  chainIds: z.array(z.string()),
  templateId: airnodeValidator.config.evmIdSchema,
  templateParameters: z.array(templateParametersSchema),
  endpointId: airnodeValidator.config.evmIdSchema,
  deviationPercentage: z.string(),
  keeperSponsor: z.string(),
  requestSponsor: z.string(),
});

// TODO: XOR?
// either rrpBeaconServerKeeperJobs or protoPsp should be set
// or maybe they both need to be optional 🤔
export const triggersSchema = z.object({
  rrpBeaconServerKeeperJobs: z.array(rrpBeaconServerKeeperJobsTriggerSchema),
  protoPsp: z.array(z.string()),
});

export const subscriptionSchema = z.object({
  chainId: z.string(),
  airnodeAddress: z.string(),
  templateId: airnodeValidator.config.evmIdSchema,
  parameters: z.string(),
  conditions: z.string(),
  relayer: z.string(),
  sponsor: z.string(),
  requester: z.string(),
  fulfillFunctionId: z.string(),
});

export const subscriptionsSchema = z.record(subscriptionSchema);

export const templateSchema = z.object({
  endpointId: airnodeValidator.config.evmIdSchema,
  encodedParameters: z.string(),
});

export const templatesSchema = z.record(templateSchema);

export const endpointSchema = z.object({
  oisTitle: z.string(),
  endpointName: z.string(),
});

export const endpointsSchema = z.record(endpointSchema);

export const chainContractsSchema = airnodeValidator.config.chainContractsSchema.extend({
  RrpBeaconServer: z.string(),
  DapiServer: z.string(),
});

export const chainSchema = z.object({
  blockHistoryLimit: z.number().int().optional(), // Defaults to BLOCK_COUNT_HISTORY_LIMIT defined in airnode-node
  contracts: chainContractsSchema,
  id: z.string(),
  type: airnodeValidator.config.chainTypeSchema,
  options: airnodeValidator.config.chainOptionsSchema,
  providers: z.record(z.string(), airnodeValidator.config.providerSchema),
});

export const chainsSchema = z.array(chainSchema);

export const nodeSettingsSchema = z.object({
  airnodeAddress: airnodeValidator.config.evmAddressSchema.optional(),
  airnodeXpub: z.string().optional(),
  airnodeWalletMnemonic: z.string(),
  logFormat: airnodeValidator.config.logFormatSchema,
  logLevel: airnodeValidator.config.logLevelSchema,
});

export const configSchema = z
  .object({
    chains: chainsSchema,
    nodeSettings: nodeSettingsSchema,
    triggers: triggersSchema,
    subscriptions: subscriptionsSchema,
    templatesV1: templatesSchema,
    endpoints: endpointsSchema,
    ois: z.array(airnodeOis.oisSchema),
    apiCredentials: z.array(airnodeValidator.config.apiCredentialsSchema),
  })
  .strict();

export type SchemaType<Schema extends ZodFirstPartySchemaTypes> = z.infer<Schema>;

export type Config = SchemaType<typeof configSchema>;
export type ChainConfig = z.infer<typeof chainSchema>;
export type NodeSettings = z.infer<typeof nodeSettingsSchema>;
export type Triggers = z.infer<typeof triggersSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;
export type Subscriptions = z.infer<typeof subscriptionsSchema>;
export type Template = z.infer<typeof templateSchema>;
export type Templates = z.infer<typeof templatesSchema>;
export type Endpoint = z.infer<typeof endpointSchema>;
export type Endpoints = z.infer<typeof endpointsSchema>;

export const validateConfig = (config: Config) => configSchema.safeParse(config);
