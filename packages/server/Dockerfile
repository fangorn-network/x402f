# FROM node:22-alpine AS base
# ENV PNPM_HOME="/pnpm"
# ENV PATH="$PNPM_HOME:$PATH"
# RUN corepack enable

# FROM base AS build
# COPY . /app
# WORKDIR /app
# RUN pnpm install --frozen-lockfile
# RUN pnpm deploy --filter=server --prod --legacy /prod/server

# FROM base AS server
# COPY --from=build /prod/server /prod/server
# WORKDIR /prod/server
# EXPOSE 30333
# CMD ["npx", "tsx", "src/index.ts"]

FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@10.32.0

FROM base AS build
COPY . /app
WORKDIR /app
RUN pnpm install --frozen-lockfile
RUN rm -rf examples
RUN pnpm deploy --filter=server --prod --legacy /prod/server

FROM base AS server
COPY --from=build /prod/server /prod/server
WORKDIR /prod/server
EXPOSE 30333
CMD ["npx", "tsx", "src/index.ts"]