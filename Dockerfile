ARG build=local

# Environment
FROM node:14.17-alpine3.14 AS environment

ENV name="airkeeper" \
    appDir="/app" \
    buildDir="/build"
ENV packageDir="${buildDir}/package"

# Build preparation
FROM environment AS preparation

WORKDIR ${buildDir}

RUN apk add --update --no-cache git

# Source preparation - local
FROM preparation as sourcelocal

COPY . ${buildDir}

# Source preparation - git
FROM preparation as sourcegit

ARG branch=main
ARG repository=https://github.com/api3dao/airkeeper.git

RUN git clone --single-branch --branch ${branch} ${repository} ${buildDir}

# Production dependencies
FROM source${build} AS deps

RUN yarn install --production --no-optional --ignore-scripts

FROM source${build} AS build

RUN yarn install && \
    yarn build && \
    yarn pack && \
    mkdir -p ${packageDir} && \
    tar -xf *.tgz -C ${packageDir} --strip-components 1

# Result image
FROM environment

WORKDIR ${appDir}

LABEL application=${name} \
    description="Airkeeper lambda function"

COPY --from=deps ${buildDir}/node_modules ./node_modules
COPY --from=build ${packageDir} .

# Create Airkeeper user
RUN adduser -h ${appDir} -s /bin/false -S -D -H ${name} && \
    chown -R ${name} ${appDir} && \
    # Install serverless
    yarn global add serverless

USER ${name}

ENTRYPOINT ["sls"]
