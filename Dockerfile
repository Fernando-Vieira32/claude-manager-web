# O app **e** o Claude Code na mesma imagem — é isso que faz ele rodar em qualquer PC
# com Docker (Windows, Mac, Linux) sem instalar Node nem CLI do lado de fora.
#
# Por que o CLI vem para dentro: um container Linux não executa o binário do host
# (no Windows ele é `.exe`, no Mac é Mach-O). Tentar usar o `claude` da máquina só
# funcionaria em Linux — dentro da imagem funciona em todo lugar.
#
# A imagem NÃO carrega credencial nenhuma. O login mora no volume `claude-home`,
# feito uma vez pelo dono (`docker compose exec app claude login`). Por isso ela
# pode ser compartilhada sem vazar nada.

FROM node:22-slim

# `procps` dá o `ps`, que é como o painel Sessões enxerga os processos do Claude.
# `git` porque quase todo trabalho de código dentro do chat esbarra nele.
RUN apt-get update \
 && apt-get install -y --no-install-recommends procps git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code \
 && npm cache clean --force

# Home de reserva, para `docker run` cru não ficar sem HOME (o uid não existe no
# /etc/passwd da imagem). No uso normal o compose SUBSTITUI isto pelo home do dono,
# montado no mesmo caminho — é de lá que vêm as conversas e o login.
ENV HOME=/home/claude
RUN mkdir -p /home/claude && chmod -R 0777 /home/claude

WORKDIR /app
COPY . .
RUN mkdir -p /app/data && chmod 0777 /app/data

# Dentro do container ele escuta em todas as interfaces — senão o `-p` não alcançaria
# o processo. Quem limita a exposição é o compose, que publica só em 127.0.0.1.
# O autoupdate fica desligado porque rodamos como usuário comum: ele não conseguiria
# escrever em /usr/local/lib e só geraria erro a cada disparo.
ENV HOST=0.0.0.0 \
    PORT=7788 \
    NODE_ENV=production \
    DISABLE_AUTOUPDATER=1

EXPOSE 7788

HEALTHCHECK --interval=10s --timeout=3s --start-period=3s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7788)+'/api/_health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
