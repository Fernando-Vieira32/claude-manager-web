#!/usr/bin/env bash
# Gera o lançador (.desktop) desta máquina: um clique = servidor de pé + navegador
# aberto. O arquivo não vem no repo porque carrega o caminho absoluto da pasta,
# que muda de máquina para máquina — por isso ele é gerado aqui.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
NOME='Claude Manager Web'
DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"

escrever() {
  cat > "$1" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=$NOME
Comment=Sobe o painel do Claude Code e abre no navegador
Exec=$DIR/start.sh
Path=$DIR
Icon=utilities-system-monitor
Terminal=false
Categories=Development;
StartupNotify=true
EOF
  chmod +x "$1"
}

mkdir -p "$DESKTOP_DIR" ~/.local/share/applications
escrever "$DESKTOP_DIR/$NOME.desktop"
escrever "$HOME/.local/share/applications/$NOME.desktop"

# O GNOME só executa ícone da área de trabalho marcado como confiável.
gio set -t string "$DESKTOP_DIR/$NOME.desktop" metadata::trusted true 2>/dev/null || true
update-desktop-database ~/.local/share/applications 2>/dev/null || true

echo "atalho criado em:"
echo "  $DESKTOP_DIR/$NOME.desktop        (área de trabalho)"
echo "  ~/.local/share/applications/$NOME.desktop   (menu de aplicativos)"
