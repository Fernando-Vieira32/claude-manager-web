#!/usr/bin/env bash
# Sobe o servidor (se ainda não estiver de pé) e abre no navegador.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-7788}"
URL="http://127.0.0.1:$PORT"

# Clicado por um lançador (.desktop), não há terminal para ler o erro: avisa na tela.
fail() {
  echo "erro: $1" >&2
  command -v notify-send >/dev/null 2>&1 && notify-send -u critical 'Claude Manager Web' "$1" || true
  exit 1
}

# node 18+ e o CLI claude, os dois no PATH — o servidor precisa do primeiro e o
# chat dispara o segundo. Um .desktop não carrega o ~/.zshrc, então aqui o PATH é
# o do sistema (node velho, sem claude); nesse caso carregamos o nvm na mão.
runtime_ok() {
  command -v claude >/dev/null 2>&1 || return 1
  local major
  major=$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null) || return 1
  [ "${major:-0}" -ge 18 ]
}

if ! runtime_ok; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  set +eu
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  set -eu
fi
runtime_ok || fail "preciso de node 18+ e do CLI claude no PATH (o nvm em $HOME/.nvm não carregou)"

# Libera os modos "automático" e "aceitar edições" no chat — o Claude passa a
# editar arquivos e rodar comandos direto, SEM perguntar, a partir do navegador.
# Para desligar, comente a linha abaixo (ou troque 1 por 0) e reinicie.
export CHAT_ALLOW_FULL_TOOLS=1

if curl -sf "$URL/api/_health" >/dev/null 2>&1; then
  echo "servidor já rodando em $URL"
else
  echo "subindo servidor em $URL ..."
  setsid node server.js > /tmp/claude-manager-web.log 2>&1 < /dev/null &
  for _ in $(seq 1 20); do
    curl -sf "$URL/api/_health" >/dev/null 2>&1 && break
    sleep 0.25
  done
fi

command -v xdg-open >/dev/null && xdg-open "$URL" >/dev/null 2>&1 || echo "abra $URL no navegador"
echo "log: /tmp/claude-manager-web.log"
echo "parar: kill \$(pgrep -f 'node server.js' | head -1)"
