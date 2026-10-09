# Snake Game Server — Oracle Cloud Deploy Guide (v23)

Yeh package Snake Premium game ka **Socket.io game server** hai (v23).
Yeh tumhare Ubuntu 22.04 VM par chalega — hamesha ON, kabhi sleep nahi hota.

## Step 1 — Server me login karo (SSH)

Apne PC se (Windows me PowerShell, ya PuTTY):

```bash
ssh -i "tumhari-private-key.key" ubuntu@TUMHARA_SERVER_IP
```

- `tumhari-private-key.key` = Oracle ne jo private key file di thi
- `TUMHARA_SERVER_IP` = Oracle console me instance ka **Public IP**
- Pehli baar pooche `Are you sure...` to `yes` likho

## Step 2 — Node.js 20 install karo

Server ke andar yeh commands ek-ek karke chalao:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # v20.x.x dikhna chahiye
```

## Step 3 — ZIP upload karo aur nikalo

Apne PC se ZIP server par bhejo (PowerShell se, `snake-server` folder jahan ZIP hai wahan se):

```powershell
scp -i "tumhari-private-key.key" Snake-Server_Oracle-Deploy_v1.0.0.zip ubuntu@TUMHARA_SERVER_IP:~/
```

Phir server me:

```bash
sudo apt install -y unzip
unzip ~/Snake-Server_Oracle-Deploy_v1.0.0.zip -d ~/snake-server
cd ~/snake-server
```

## Step 4 — Dependencies install karo

```bash
npm install
```

(2-4 minute lagega, ghabrana mat.)

## Step 5 — `.env` file banao (asli values ke saath)

```bash
cp .env.example .env
nano .env
```

- `PORT=4000` rehne do
- `FIREBASE_SERVICE_ACCOUNT_JSON=` ke aage apne Firebase service account ki **poori JSON ek line me** paste karo
  (Firebase Console → Project settings → Service accounts → Generate new private key)
- `FIREBASE_DATABASE_URL=` ke aage apne Realtime Database ka URL likho
- Save: `Ctrl+O`, `Enter`, phir `Ctrl+X`

> Bina in dono ke server chalega, par **ranked rooms kaam nahi karenge**.

## Step 6 — pm2 se hamesha-ON karo

```bash
sudo npm install -g pm2
pm2 start "npm start" --name snake-server
pm2 save
pm2 startup   # jo command bataye, use copy karke chalao (sudo wali)
```

Server restart hone par bhi game server khud start ho jayega.

## Step 7 — Firewall me port 4000 kholo

Server ke andar:

```bash
sudo ufw allow 4000/tcp
sudo ufw allow 22/tcp
sudo ufw --force enable
```

**Oracle console me bhi** port kholna zaroori hai:
VCN → Security Lists → Default Security List → **Add Ingress Rule**:
- Source CIDR: `0.0.0.0/0`, Protocol: TCP, Port: `4000`

## Step 8 — Check karo chal raha hai ya nahi

Apne PC ke browser me kholo:

```
http://TUMHARA_SERVER_IP:4000/health
```

`ranked: true` dikhe to sab perfect hai. `ranked: false` dikhe to `.env` ki Firebase values check karo.

## Game ko naye server se jodna

Game ke `.env` me (PC par):

```
NEXT_PUBLIC_SNAKE_SERVER_URL=http://TUMHARA_SERVER_IP:4000
```

Phir game dobara build karo — multiplayer ab naye permanent server se chalega.

## Zaroori commands (yaad rakhna)

```bash
pm2 logs snake-server     # server ke logs dekhna
pm2 restart snake-server  # server restart karna
pm2 stop snake-server     # server band karna
```
