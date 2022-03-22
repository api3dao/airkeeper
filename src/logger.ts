import * as node from '@api3/airnode-node';

type LogOptionsOverride = 'meta' | 'additional';

export const buildLogOptions = (
  override: LogOptionsOverride,
  fields: { [key: string]: unknown },
  baseLogOptions: node.LogOptions
): node.LogOptions => {
  switch (override) {
    case 'meta':
      return {
        ...baseLogOptions,
        meta: {
          ...baseLogOptions.meta,
          ...fields,
        },
      };
    case 'additional':
      return {
        ...baseLogOptions,
        additional: {
          ...baseLogOptions.additional,
          ...fields,
        },
      };
  }
};
