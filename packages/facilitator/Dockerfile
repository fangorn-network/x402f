# FROM node:22-alpine
# RUN npm install -g pnpm
# WORKDIR /app
# # Copy workspace config first
# # COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
# # Copy all packages (needed for local deps like fangorn-sdk)
# COPY . .
# # Install deps using the lockfile
# RUN pnpm install --no-frozen-lockfile --shamefully-hoist
# # RUN CI=true pnpm install
# EXPOSE 30333
# CMD ["npx", "tsx", "packages/facilitator/src/index.ts"]


FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
COPY . /app
WORKDIR /app
RUN pnpm install --frozen-lockfile
RUN pnpm deploy --filter=facilitator --prod --legacy /prod/facilitator

FROM base AS facilitator
COPY --from=build /prod/facilitator /prod/facilitator
WORKDIR /prod/facilitator
EXPOSE 30333
CMD ["npx", "tsx", "src/index.ts"]