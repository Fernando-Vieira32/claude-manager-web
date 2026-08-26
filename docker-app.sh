#!/usr/bin/env bash
# Sobe o app em container e abre a janela. Idempotente: se já estiver de pé, só abre.
#
#   ./docker-app.sh          sobe (construindo se preciso) e abre
#   ./docker-app.sh login    faz o login do Claude dentro do container (uma vez)
#   ./docker-app.sh parar    desliga (o login e as conversas ficam nos volumes)
#   ./docker-app.sh log      acompanha o log do servidor
set -euo pipefail
cd "$(dirname "$0")"

command -v docker >/dev/null || { echo 'erro: Docker não está instalado' >&2; exit 1; }
if docker compose version >/dev/null 2>&1; then DC=(docker compose); else DC=(docker-compose); fi

# O .env é desta máquina (uid, caminho do código) — por isso ele é gerado aqui e não
# vem no repo, igual ao atalho .desktop.
if [ ! -f .env ]; then
  cat > .env <<EOF
# Pasta que o Claude enxerga dentro do container (vira ~/work). Troque se o seu
# código não estiver no home.
WORK_DIR=$HOME
APP_UID=$(id -u)
APP_GID=$(id -g)
PORT=7788
# 0 deixa o chat só-leitura (sem os modos automático/aceitar-edições).
CHAT_ALLOW_FULL_TOOLS=1
EOF
  echo "criei o .env (código em $HOME). Edite WORK_DIR se quiser outra pasta."
fi

set -a; . ./.env; set +a
PORT="${PORT:-7788}"
URL="http://127.0.0.1:$PORT"

case "${1:-subir}" in
  parar) "${DC[@]}" down; exit 0 ;;
  log)   "${DC[@]}" logs -f; exit 0 ;;
  login) "${DC[@]}" up -d; exec "${DC[@]}" exec app claude login ;;
esac

# Porta ocupada por OUTRO servidor (o ./start.sh nativo, por exemplo) daria um erro
# cru do daemon no meio do `up`. Melhor dizer o que houve antes de tentar.
rodando() { [ "$(docker inspect -f '{{.State.Running}}' claude-manager-web 2>/dev/null)" = true ]; }
if ! rodando && (exec 3<>/dev/tcp/127.0.0.1/"$PORT") 2>/dev/null; then
  echo "erro: a porta $PORT já está ocupada (outro servidor de pé?)." >&2
  echo "      pare o outro ou troque PORT no .env" >&2
  exit 1
fi

"${DC[@]}" up -d --build

# Espera o healthcheck da imagem em vez de dormir um tempo fixo: ele é a única
# resposta honesta sobre "já dá para abrir?".
for _ in $(seq 1 60); do
  estado=$(docker inspect -f '{{.State.Health.Status}}' claude-manager-web 2>/dev/null || echo '')
  [ "$estado" = healthy ] && break
  sleep 0.5
done
[ "${estado:-}" = healthy ] || { echo "servidor não respondeu; veja: ./docker-app.sh log" >&2; exit 1; }

# Sem login o chat não roda — avisa em vez de deixar o amigo descobrir no erro.
"${DC[@]}" exec -T app test -f /home/claude/.claude/.credentials.json 2>/dev/null \
  || echo 'atenção: o Claude ainda não tem login neste container — rode ./docker-app.sh login'

# Janela de app (sem barra de endereço) quando houver um navegador que suporte;
# senão, aba normal.
abrir() {
  for nav in google-chrome chromium chromium-browser brave-browser microsoft-edge; do
    command -v "$nav" >/dev/null 2>&1 && { "$nav" --app="$URL" >/dev/null 2>&1 & return 0; }
  done
  command -v xdg-open >/dev/null 2>&1 && { xdg-open "$URL" >/dev/null 2>&1 & return 0; }
  command -v open >/dev/null 2>&1 && { open "$URL" >/dev/null 2>&1 & return 0; }
  echo "abra $URL no navegador"
}
abrir

echo "no ar: $URL"
echo "parar: ./docker-app.sh parar"
