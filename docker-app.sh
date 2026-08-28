#!/usr/bin/env bash
# Sobe o app em container e abre a janela. Idempotente: se já estiver de pé, só abre.
#
#   ./docker-app.sh          usar: sobe (construindo se preciso) e abre
#   ./docker-app.sh dev      desenvolver: código montado, reinicia ao salvar, mostra o log
#   ./docker-app.sh test     roda `npm test` dentro do container, no código montado
#   ./docker-app.sh login    faz o login do Claude dentro do container (uma vez)
#   ./docker-app.sh parar    desliga (o login e as conversas ficam nos volumes)
#   ./docker-app.sh log      acompanha o log do servidor
#
# Alvo: Linux (ver readme/14-docker.md).
set -euo pipefail
cd "$(dirname "$0")"

command -v docker >/dev/null || { echo 'erro: Docker não está instalado' >&2; exit 1; }
if docker compose version >/dev/null 2>&1; then DC=(docker compose); else DC=(docker-compose); fi
DEV=("${DC[@]}" -f docker-compose.yml -f docker-compose.dev.yml)

# O .env é desta máquina (uid, caminho do home) — por isso ele é gerado aqui e não vem
# no repo, igual ao atalho .desktop.
if [ ! -f .env ]; then
  cat > .env <<EOF
# Seu home. Entra no container no MESMO caminho, e é o que faz o app ler o seu
# ~/.claude de verdade: conversas do terminal aparecem e o login já vale.
HOST_HOME=$HOME
APP_UID=$(id -u)
APP_GID=$(id -g)
PORT=7788
# 0 deixa o chat só-leitura (sem os modos automático/aceitar-edições).
CHAT_ALLOW_FULL_TOOLS=1
EOF
  echo "criei o .env (home: $HOME)"
fi

# .env de antes do home no mesmo caminho: completa em vez de quebrar com o erro do compose.
grep -q '^HOST_HOME=' .env || { echo "HOST_HOME=$HOME" >> .env; echo 'acrescentei HOST_HOME ao .env'; }

# Bind mount de pasta que não existe é criado pelo daemon como root — e aí o app não
# escreve nas preferências. Melhor garantir que ela nasce sua.
mkdir -p data

set -a; . ./.env; set +a
PORT="${PORT:-7788}"
URL="http://127.0.0.1:$PORT"

rodando() { [ "$(docker inspect -f '{{.State.Running}}' claude-manager-web 2>/dev/null)" = true ]; }

# Porta ocupada por outro programa daria um erro cru do daemon no meio do `up`.
# Melhor dizer o que houve antes de tentar.
porta_livre() {
  rodando && return 0
  (exec 3<>/dev/tcp/127.0.0.1/"$PORT") 2>/dev/null || return 0
  echo "erro: a porta $PORT já está ocupada (outro servidor de pé?)." >&2
  echo "      pare o outro ou troque PORT no .env" >&2
  return 1
}

# Espera o healthcheck da imagem em vez de dormir um tempo fixo: ele é a única
# resposta honesta sobre "já dá para abrir?".
esperar() {
  local estado=''
  for _ in $(seq 1 60); do
    estado=$(docker inspect -f '{{.State.Health.Status}}' claude-manager-web 2>/dev/null || echo '')
    [ "$estado" = healthy ] && return 0
    sleep 0.5
  done
  echo "servidor não respondeu; veja: ./docker-app.sh log" >&2
  return 1
}

# Sem login o chat não roda. Como o home é o seu, aqui normalmente já está tudo certo —
# o aviso só aparece para quem nunca usou o Claude Code nesta máquina.
avisar_login() {
  "${DC[@]}" exec -T app test -f "$HOST_HOME/.claude/.credentials.json" 2>/dev/null \
    || echo 'atenção: não achei login do Claude neste home — rode ./docker-app.sh login'
}

# Janela de app (sem barra de endereço) quando houver navegador que suporte.
# `setsid` porque o navegador tem de sobreviver ao fim deste script: sem isso ele morre
# junto com o shell que o chamou (e num lançador .desktop nem chega a aparecer).
solto() {
  if command -v setsid >/dev/null 2>&1; then
    setsid "$@" >/dev/null 2>&1 < /dev/null &
  else
    nohup "$@" >/dev/null 2>&1 < /dev/null &
  fi
  disown 2>/dev/null || true
}

abrir() {
  for nav in google-chrome chromium chromium-browser brave-browser microsoft-edge; do
    command -v "$nav" >/dev/null 2>&1 && { solto "$nav" --app="$URL"; return 0; }
  done
  command -v xdg-open >/dev/null 2>&1 && { solto xdg-open "$URL"; return 0; }
  echo "abra $URL no navegador"
}

case "${1:-usar}" in
  parar) "${DC[@]}" down ;;
  log)   "${DC[@]}" logs -f ;;
  login) "${DC[@]}" up -d && exec "${DC[@]}" exec app claude login ;;

  # Suíte no código MONTADO (não no da imagem), para valer no que você acabou de editar.
  test)  exec "${DEV[@]}" run --rm --no-deps app npm test ;;

  dev)
    porta_livre
    "${DEV[@]}" up -d --build
    esperar
    avisar_login
    abrir
    echo "modo dev em $URL — salvou, reiniciou. Ctrl+C só para de seguir o log."
    "${DEV[@]}" logs -f
    ;;

  usar)
    porta_livre
    "${DC[@]}" up -d --build
    esperar
    avisar_login
    abrir
    echo "no ar: $URL"
    echo "parar: ./docker-app.sh parar"
    ;;

  *) echo "comando desconhecido: $1 (use: dev, test, login, parar, log)" >&2; exit 1 ;;
esac
