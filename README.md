# AnimRetargetAndroid — тестовая сборка Android

Здесь собирается **оригинальный проект Anim Retarget** без изменения алгоритмов ретаргетинга.

## Как получить APK

1. Скачайте архив `AnimRetargetAndroid_GitHub_Actions.zip` из чата ChatGPT.
2. В этом репозитории нажмите **Add file → Upload files** и загрузите **сам ZIP-архив**, не распаковывая его. Имя должно остаться `AnimRetargetAndroid_GitHub_Actions.zip`.
3. Нажмите **Commit changes**.
4. Откройте вкладку **Actions → Build Anim Retarget APK**. Сборка запускается автоматически после загрузки архива, либо кнопкой **Run workflow**.
5. В успешном запуске в разделе **Artifacts** скачайте `AnimRetargetAndroid-debug-APK` и извлеките из него `app-debug.apk` для установки на Android.

## Ограничения оригинала

Импорт целевого персонажа заявлен для FBX, исходные анимации FBX/BVH/ZIP. GLB в этой версии напрямую не поддерживается. Сначала проверяем исходную реализацию, затем решаем, что дорабатывать.

Исходники и Gradle Wrapper находятся внутри указанного ZIP-архива; workflow извлекает их перед сборкой.
