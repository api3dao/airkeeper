import * as airnodeValidator from '@api3/airnode-validator';
import * as airnodeOis from '@api3/ois';
import { RefinementCtx, z, ZodFirstPartySchemaTypes } from 'zod';

export const templateParametersSchema = z.object({ type: z.string(), name: z.string(), value: z.string() });

export const rrpBeaconServerKeeperJobsTriggerSchema = z.object({
  chainIds: z.array(z.string()),
  templateId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  templateParameters: z.array(templateParametersSchema),
  endpointId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  deviationPercentage: z.string(),
  keeperSponsor: z.string(),
  requestSponsor: z.string(),
});

// TODO: XOR?
// either rrpBeaconServerKeeperJobs or protoPsp should be set
// or maybe they both need to be optional 🤔
export const triggersSchema = airnodeValidator.config.triggersSchema.extend({
  rrpBeaconServerKeeperJobs: z.array(rrpBeaconServerKeeperJobsTriggerSchema),
  protoPsp: z.array(z.string()),
});

export const subscriptionSchema = z.object({
  chainId: z.string(),
  airnodeAddress: z.string(),
  templateId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  parameters: z.string(),
  conditions: z.string(),
  relayer: z.string(),
  sponsor: z.string(),
  requester: z.string(),
  fulfillFunctionId: z.string(),
});

export const subscriptionsSchema = z.record(subscriptionSchema);

export const templateSchema = z.object({
  endpointId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
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

export const chainSchema = airnodeValidator.config.chainConfigSchema.extend({
  contracts: chainContractsSchema,
});

export const chainsSchema = z.array(chainSchema);

export const configSchema = z
  .object({
    airnodeAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .optional(),
    airnodeXpub: z.string().optional(),
    chains: chainsSchema,
    nodeSettings: airnodeValidator.config.nodeSettingsSchema,
    triggers: triggersSchema,
    templates: z.array(airnodeValidator.config.templateSchema),
    subscriptions: subscriptionsSchema,
    templatesV1: templatesSchema,
    endpoints: endpointsSchema,
    ois: z.array(airnodeOis.oisSchema),
    apiCredentials: z.array(airnodeValidator.config.apiCredentialsSchema),
  })
  .strict();
export type SchemaType<Schema extends ZodFirstPartySchemaTypes> = z.infer<Schema>;
export type ValidatorRefinement<T> = (arg: T, ctx: RefinementCtx) => void;

export type Config = SchemaType<typeof configSchema>;
export type ChainConfig = z.infer<typeof chainSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;
export type Subscriptions = z.infer<typeof subscriptionsSchema>;
export type Template = z.infer<typeof templateSchema>;
export type Templates = z.infer<typeof templatesSchema>;
export type Endpoint = z.infer<typeof endpointSchema>;
export type Endpoints = z.infer<typeof endpointsSchema>;

export const validateConfig = (config: Config) => configSchema.safeParse(config);
