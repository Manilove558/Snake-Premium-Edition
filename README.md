# Click sound + vibration on every button, Settings icons

Settings -> Sound row and Vibration row now have icons (Controls, Movement, Theme, Click sound and the volume slider already had one).
Settings -> "VIBRATION & SOUND" -> "Click sound" switch (ON by default, saved on the device).
Every button / link / switch / tab / checkbox press now gives:
  * a click sound  (needs the "Click sound" switch AND the game "Sound" switch; follows the volume slider)
  * a short 15 ms vibration (follows the "Vibration" switch; devices without vibration support do nothing)
Opt a single button out:  data-no-click-sound  (no sound)   /   data-no-haptic  (no vibration)

NEW       public/sounds/click.mp3        your Click_button_effect (+8 dB)
NEW       hooks/use-click-sound.ts, hooks/use-click-haptic.ts, lib/pressable.ts, lib/click-sound.ts
MODIFIED  components/home-popups.tsx, components/snake-game.tsx

NOTE: those two components ALSO contain the earlier smooth-movement update.
