@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Barba-vania
set "GAME_DIR=D:\Barba-vania"
set "REPO_URL=https://github.com/madema-art/Barba-vania.git"
set "GAME_BRANCH=claude/magical-hopper-7npp9w"
set "GIT_TERMINAL_PROMPT=0"
echo.
echo === Barba-vania ===
echo Game folder: %GAME_DIR%
echo.
where git >nul 2>&1
if errorlevel 1 goto no_git
if exist "%GAME_DIR%\.git" goto update
if exist "%GAME_DIR%" goto occupied
echo Downloading the game for the first time...
git clone --single-branch --branch "%GAME_BRANCH%" "%REPO_URL%" "%GAME_DIR%"
if errorlevel 1 goto clone_failed
echo Game downloaded successfully.
goto launch

:update
rem Refuse nested repositories, unrelated origins, and unexpected branches.
set "REPO_ROOT="
for /f "delims=" %%G in ('git -C "%GAME_DIR%" rev-parse --show-toplevel 2^>nul') do set "REPO_ROOT=%%G"
if /i not "%REPO_ROOT%"=="D:/Barba-vania" goto wrong_repo
set "ORIGIN_URL="
for /f "delims=" %%G in ('git -C "%GAME_DIR%" config --get remote.origin.url 2^>nul') do set "ORIGIN_URL=%%G"
if /i "%ORIGIN_URL%"=="%REPO_URL%" goto check_branch
if /i "%ORIGIN_URL%"=="https://github.com/madema-art/Barba-vania" goto check_branch
goto wrong_repo

:check_branch
set "LOCAL_BRANCH="
for /f "delims=" %%G in ('git -C "%GAME_DIR%" symbolic-ref --quiet --short HEAD 2^>nul') do set "LOCAL_BRANCH=%%G"
if not "%LOCAL_BRANCH%"=="%GAME_BRANCH%" goto wrong_branch
echo Checking GitHub for updates...
rem Fetch the explicit branch; never rely on the user's upstream configuration.
git -C "%GAME_DIR%" -c credential.interactive=false fetch --no-tags "%REPO_URL%" "refs/heads/%GAME_BRANCH%"
if errorlevel 1 goto offline
rem Fail closed if status cannot be read. Include untracked files.
git -C "%GAME_DIR%" status --porcelain --untracked-files=all >nul 2>&1
if errorlevel 1 goto unsafe
set "DIRTY="
for /f "delims=" %%G in ('git -C "%GAME_DIR%" status --porcelain --untracked-files^=all 2^>nul') do set "DIRTY=1"
if defined DIRTY goto unsafe
for %%G in (MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-merge rebase-apply sequencer BISECT_LOG) do if exist "%GAME_DIR%\.git\%%G" goto unsafe
rem Local commits, including an ahead-only branch, are left untouched.
git -C "%GAME_DIR%" merge-base --is-ancestor HEAD FETCH_HEAD
if errorlevel 1 goto unsafe
git -C "%GAME_DIR%" -c merge.autostash=false merge --ff-only --no-edit FETCH_HEAD
if errorlevel 1 goto unsafe
echo Update check completed successfully.
goto launch

:no_git
echo WARNING: Git for Windows is required to download or update the game.
echo Install it from https://git-scm.com/download/win and run this file again.
goto launch
:occupied
echo WARNING: The game folder exists but is not a Git repository. It was left untouched.
goto launch
:wrong_repo
echo WARNING: The folder is not the expected Barba-vania checkout. Update skipped.
goto launch
:wrong_branch
echo WARNING: The checkout is on another branch or detached. Update skipped.
goto launch
:offline
echo WARNING: GitHub could not be reached or the branch could not be fetched.
echo Launching the existing local game without updating.
goto launch
:unsafe
echo WARNING: An update could not be applied safely. Local work was preserved.
echo Launching the existing local game without updating.
goto launch
:clone_failed
echo ERROR: The first download failed. Check your connection and Git installation.
echo Any partially created folder was left untouched for inspection.
goto finish_error

:launch
if not exist "%GAME_DIR%\index.html" goto missing_game
echo.
echo Opening %GAME_DIR%\index.html in your default browser...
rem Clear a prior Git failure before testing START's own result.
cmd /d /c exit 0
start "" /D "%GAME_DIR%" "%GAME_DIR%\index.html"
if errorlevel 1 goto launch_failed
echo Keep this launcher anywhere, including your desktop.
echo.
pause
exit /b 0
:missing_game
echo ERROR: No playable index.html was found at %GAME_DIR%.
goto finish_error
:launch_failed
echo ERROR: Windows could not open the game. Check your default browser association.
:finish_error
echo.
pause
exit /b 1
