# Otomatik DKP güncellemesi — kurulum

Bir kez kur, sonra hiç dokunma. Günde üç kez Statsmaster dashboard'una girip
veriyi çeker, `dkp.json` dosyasını günceller, site otomatik yeni veriyi gösterir.

## Repodaki dosya yapısı

```
kingdom-3922.html          <- site (index.html olarak da adlandırabilirsin)
dkp.json                   <- script üretir, sen dokunmuyorsun
scripts/
  scrape-dkp.mjs
.github/
  workflows/
    dkp-update.yml
```

Bu paketteki `dkp-update.yml` dosyasını `.github/workflows/` altına,
`scrape-dkp.mjs` dosyasını `scripts/` altına koy. Klasör adları önemli,
GitHub bu yolları arıyor.

## Linki gizli tut

Statsmaster linkindeki `ir3qnyjlzpxqe6q` kısmı senin dashboard'unun anahtarı.
Repo herkese açık olduğu için linki dosyaların içine **yazma**. Onun yerine:

1. Repoda **Settings → Secrets and variables → Actions**
2. **New repository secret**
3. Name: `STATS_URL`
4. Secret: linkin tamamı
5. Add secret

Script linki oradan okur, log'lara da yazılmaz.

## İlk çalıştırma

**Actions** sekmesine gel, soldan **DKP güncelle** iş akışını seç,
sağdaki **Run workflow** butonuna bas. 2-3 dakika sürer.

- **Yeşil tik:** çalıştı. Repoda `dkp.json` oluşmuş olmalı, siteye gir ve
  DKP sekmesine bak.
- **Kırmızı çarpı:** çalışmadı. İş akışına tıkla, en altta **debug** adlı bir
  dosya eki olacak. Onu indir, içindeki `page.png` ekran görüntüsünü ve
  `captures.json` dosyasını bana gönder — script'i ona göre düzeltirim.

## Sonrası

Bir daha hiçbir şey yapmıyorsun. Zamanlama `dkp-update.yml` dosyasının
başındaki `cron` satırında; sıklığı değiştirmek istersen orayı düzenle.
Statsmaster'daki veri sadece yeni scan yapıldığında değiştiği için günde üç
kez fazlasıyla yeterli — veri değişmemişse script commit bile atmıyor.

## Not

`data/_source.json` dosyasına script'in veriyi nereden aldığını yazıyorum.
Orada `"method": "network"` ve bir adres görürsen, sonraki adımda tarayıcıyı
tamamen aradan çıkarıp doğrudan o adresten çekebiliriz — çok daha hızlı ve
kırılgan olmayan bir yol olur. O dosyanın içeriğini bana gönder, yeni sürümü
yazayım.
