FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@10.32.0

FROM base AS build
COPY . /app
WORKDIR /app
RUN pnpm install --frozen-lockfile
RUN rm -rf examples
RUN pnpm deploy --filter=facilitator --prod --legacy /prod/facilitator

FROM base AS facilitator
COPY --from=build /prod/facilitator /prod/facilitator
WORKDIR /prod/facilitator
EXPOSE 30333
CMD ["npx", "tsx", "src/index.ts"]