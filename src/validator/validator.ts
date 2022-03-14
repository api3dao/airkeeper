import { z, ZodFirstPartySchemaTypes } from 'zod';

export const templateParametersSchema = z.object({ type: z.string(), name: z.string(), value: z.string() });

export const triggerSchema = z.object({
  chainIds: z.array(z.string()),
  templateId: z.string(),
  templateParameters: z.array(templateParametersSchema),
  endpointId: z.string(),
  deviationPercentage: z.string(),
  keeperSponsor: z.string(),
  requestSponsor: z.string(),
});

export const triggersSchema = z.object({
  rrpBeaconServerKeeperJobs: z.array(triggerSchema),
  'proto-psp': z.array(z.string()),
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
  templateParameters: z.string(),
});

export const templatesSchema = z.record(templateSchema);

export const endpointSchema = z.object({
  oisTitle: z.string(),
  endpointName: z.string(),
});

export const endpointsSchema = z.record(endpointSchema);

export const chainContractsSchema = z.object({
  RrpBeaconServer: z.string(),
  DapiServer: z.string(),
});

export const chainSchema = z.object({
  id: z.string(),
  contracts: chainContractsSchema,
});

export const chainsSchema = z.array(chainSchema);

export const configSchema = z.object({
  airnodeAddress: z.string(),
  airnodeXpub: z.string(),
  chains: chainsSchema,
  triggers: triggersSchema,
  subscriptions: subscriptionsSchema,
  templates: templatesSchema,
  endpoints: endpointsSchema,
});

export type SchemaType<Schema extends ZodFirstPartySchemaTypes> = z.infer<Schema>;
export type AirkeeperConfig = SchemaType<typeof configSchema>;
export type AirkeeperChainContracts = z.infer<typeof chainContractsSchema>;
export type AirkeeperChainConfig = z.infer<typeof chainSchema>;
export type Trigger = z.infer<typeof triggerSchema>;
export type Triggers = z.infer<typeof triggersSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;
export type Subscriptions = z.infer<typeof subscriptionsSchema>;
export type Template = z.infer<typeof templateSchema>;
export type Templates = z.infer<typeof templatesSchema>;
export type Endpoint = z.infer<typeof endpointSchema>;
export type Endpoints = z.infer<typeof endpointsSchema>;

export const validateConfig = (config: AirkeeperConfig) => configSchema.safeParse(config);
