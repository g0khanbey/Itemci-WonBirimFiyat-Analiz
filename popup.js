document.getElementById("taraBtn").addEventListener("click", () => {
    chrome.tabs.query({active: true, currentWindow: true}, tabs => {
        chrome.scripting.executeScript({
            target: {tabId: tabs[0].id},
            func: sayfayiTara
        }, (res) => {
            const data = res[0].result;
            const listeDiv = document.getElementById("liste");
            listeDiv.innerHTML = "";

            const sirali = data.sort((a,b) => a.birim - b.birim).slice(0,10);

            sirali.forEach(item => {
                listeDiv.innerHTML += `
                    <div class="item">
                        <b>${item.birim.toFixed(2)} TL/WON</b><br>
                        ${item.won} WON — ${item.fiyat} TL<br>
                        Satıcı: ${item.satici}<br>
                        <a href="${item.link}" target="_blank">İlan Linki</a>
                    </div>
                `;
            });
        });
    });
});

function sayfayiTara() {
    const ilanlar = [...document.querySelectorAll(".advert-data")];
    let sonuc = [];

    ilanlar.forEach(div => {
        try {
            const title = div.querySelector(".AdvertMd-Title").innerText;
            const fiyatText = div.querySelector(".AdvertPriceText").innerText;

            const link = div.querySelector("a.showPostLink").href;
            const satici = div.querySelector(".uUserName").innerText;

            const fiyat = parseFloat(
                fiyatText.replace(/\./g, "").replace(",", ".")
            );

            const wonMatch = title.match(/(\d+)\s*W/i);
            if (!wonMatch) return;

            const won = parseInt(wonMatch[1]);
            const birim = fiyat / won;

            sonuc.push({
                won,
                fiyat,
                birim,
                satici,
                link
            });

        } catch(e){}
    });

    return sonuc;
}
