import * as utils from '@api3/airnode-utilities';

type LogOptionsOverride = 'meta' | 'additional';

export const buildLogOptions = (
  override: LogOptionsOverride,
  fields: { [key: string]: unknown },
  baseLogOptions: utils.LogOptions
): utils.LogOptions => {
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
