@echo off
rem Sobe o app em container e abre a janela (Windows). Mesmo papel do docker-app.sh.
rem
rem   docker-app.cmd          sobe e abre
rem   docker-app.cmd login    faz o login do Claude dentro do container (uma vez)
rem   docker-app.cmd parar    desliga (login e conversas ficam nos volumes)
rem   docker-app.cmd log      acompanha o log do servidor
setlocal
cd /d "%~dp0"

where docker >nul 2>&1 || (echo erro: Docker nao esta instalado & exit /b 1)

rem O .env e desta maquina (caminho do codigo) — por isso e gerado aqui.
if not exist ".env" (
  > .env echo # Pasta que o Claude enxerga dentro do container ^(vira ~/work^).
  >> .env echo WORK_DIR=%USERPROFILE%
  >> .env echo APP_UID=1000
  >> .env echo APP_GID=1000
  >> .env echo PORT=7788
  >> .env echo # 0 deixa o chat so-leitura.
  >> .env echo CHAT_ALLOW_FULL_TOOLS=1
  echo criei o .env ^(codigo em %USERPROFILE%^). Edite WORK_DIR se quiser outra pasta.
)

if /i "%~1"=="parar" ( docker compose down & exit /b 0 )
if /i "%~1"=="log"   ( docker compose logs -f & exit /b 0 )
if /i "%~1"=="login" ( docker compose up -d & docker compose exec app claude login & exit /b 0 )

docker compose up -d --build || exit /b 1

rem Espera o healthcheck da imagem responder "healthy".
for /l %%i in (1,1,60) do (
  for /f %%s in ('docker inspect -f "{{.State.Health.Status}}" claude-manager-web 2^>nul') do (
    if "%%s"=="healthy" goto pronto
  )
  timeout /t 1 /nobreak >nul
)
echo servidor nao respondeu; veja: docker-app.cmd log
exit /b 1

:pronto
docker compose exec -T app test -f /home/claude/.claude/.credentials.json >nul 2>&1 ^
 || echo atencao: o Claude ainda nao tem login neste container - rode docker-app.cmd login

start "" http://127.0.0.1:7788
echo no ar: http://127.0.0.1:7788
echo parar: docker-app.cmd parar
