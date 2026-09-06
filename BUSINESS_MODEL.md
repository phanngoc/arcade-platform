# Arcade — Mô hình kinh doanh & định giá

> Phân tích ở góc CEO, không phải góc kỹ sư. Ngày 2026-09-06.
> Mọi con số thị trường có nguồn ở cuối. Con số **hạ tầng và tài chính là ước tính có giả định nêu rõ** —
> chưa đo thật, phải benchmark ở M1 trước khi tin.
> Đi kèm: [PLATFORM_DESIGN.md](PLATFORM_DESIGN.md) (thiết kế kỹ thuật), [SKILL_CHAIN.md](SKILL_CHAIN.md) (dây chuyền sản xuất).

---

## 1. Kết luận trước, lý lẽ sau

Ba điều quan trọng nhất, nói thẳng:

**1. Giá trị nằm ở Runtime, không nằm ở AI Forge.** Dữ liệu định giá 2026: công cụ AI đang giao dịch ở
**1–2,5× ARR** vì cạnh tranh khốc liệt và không có hào bảo vệ, trong khi SaaS bootstrapped hạ tầng
$1–5M ARR ở **4–6× ARR**. Nếu xây "máy sinh game bằng AI" làm sản phẩm chính thì đang xây đúng loại tài sản
bị thị trường chiết khấu nặng nhất. Forge nên là **kênh thu hút khách**, backend mới là **thứ để bán**.
Lý do sâu hơn: backend có chi phí chuyển đổi (dữ liệu người chơi, phòng đang chạy, code đã cắm SDK);
máy sinh game thì không — người dùng đổi sang tool khác trong 5 phút.

**2. Có một cửa sổ thời gian đang mở, và nó sẽ đóng.** Tháng 3/2026 Microsoft cắt free tier của **PlayFab từ
100.000 xuống 1.000 tài khoản trọn đời**, Foundation Mode chỉ miễn phí nếu ship trên Xbox. Một lượng indie
đang phải tìm chỗ khác **ngay bây giờ**. Đây là lý do khách hàng chuyển nhà — thứ khó kiếm nhất trong
thị trường hạ tầng. Cửa sổ này tính bằng quý, không phải bằng năm.

**3. Kịch bản cơ sở là một công ty một người sống tốt, không phải startup gọi vốn.** Với thị trường ARPU thấp
(50% game Steam 2026 kiếm dưới $250; tỉ lệ thất bại indie ~70%), kết quả thực tế nhất sau 24 tháng là
**~$50K ARR, lãi ~$35K/năm** — khoảng **850–900 triệu VNĐ/năm** cho một người ở Đà Nẵng. Đó là kết quả tốt
nếu mục tiêu là công ty một người. Đó là thất bại nếu mục tiêu là gọi vốn. **Phải chọn mục tiêu trước khi
viết dòng code đầu tiên**, vì hai mục tiêu đó dẫn tới hai sản phẩm khác nhau.

---

## 2. Thị trường: số thật

| Chỉ số | Giá trị | Ý nghĩa cho ta |
|---|---|---|
| Game BaaS market | $5,27B (2024) → $16,33B (2033), CAGR 13,6% | Thị trường thật, đang lớn — nhưng phần lớn doanh thu nằm ở studio lớn, không ở indie |
| HTML5 games market | ~$6,0B (2026) → $10,5B (2035), CAGR 6,34% | Web game không chết, nhưng tăng chậm hơn BaaS nói chung |
| Game dev toàn cầu | ~11,1 triệu (gồm hobbyist + sinh viên) | TAM theo đầu người rất lớn, **khả năng chi trả rất thấp** |
| Indie game market | $4,85B (2025) → $5,54B (2026) | |
| Thực tế phũ phàng | **50% game Steam 2026 kiếm < $250**; thất bại indie ~70% | Khách hàng mục tiêu phần lớn **không có tiền**. Free tier phải rộng, giá phải thấp, và không được kỳ vọng upsell mạnh |

**Đọc lại thị trường này như CEO:** đây không phải thị trường "bán đắt cho ít người". Đây là thị trường
"free tier rộng, giá vào thấp, sống bằng số lượng và bằng số ít khách thành công". Mô hình giá phải
được thiết kế cho sự thật đó, chứ không phải cho cái ta mong muốn.

---

## 3. Đối thủ đang thu tiền thế nào

| Đối thủ | Mô hình giá | Số cụ thể |
|---|---|---|
| **Photon** | Theo CCU, mua theo gói | 100 CCU **miễn phí**; $95/năm cho 100 CCU; **$125/tháng → 500 CCU**; $250 → 1.000; $500 → 2.000. Kèm 3GB/CCU đỉnh/tháng |
| **Colyseus** | OSS miễn phí self-host + Cloud theo compute | Cloud **từ $15/tháng**, *không giới hạn CCU/DAU/MAU*, băng thông không giới hạn |
| **Nakama / Heroic Cloud** | Theo CPU cấp phát, không đếm người chơi | Giá theo cấu hình CPU; Satori (LiveOps) **từ $600/tháng**; gói support **$2.000 / $6.000 mỗi tháng** |
| **PlayFab** | Theo gói + tiêu dùng | Dev Mode **giới hạn 1.000 tài khoản trọn đời** (cắt từ 100K, 3/2026); Standard **$99/tháng**; Premium **$1.999/tháng**; multiplayer server tính riêng theo VM Azure |
| **Supabase** (chuẩn DX để học) | Theo tổ chức + overage | Free (2 project, 500MB DB, 50K MAU, ngủ sau 1 tuần) / **Pro $25** / **Team $599** |
| **Rosebud AI** (phía Forge) | Credit | Free có credit hàng tuần (~8.000); **Pro ~$19–20/tháng** |

**Ba điều rút ra:**
1. Khoảng trống giá nằm ở **$15–99/tháng**. Trên $99 là sân của PlayFab/Nakama (bán cho studio có tiền);
   dưới $15 không đủ bù hạ tầng realtime.
2. Photon neo tâm trí thị trường ở **"100 CCU miễn phí"** — free tier của ta không được kém con số đó.
3. Colyseus bán "không giới hạn CCU từ $15" — nghĩa là **không thể cạnh tranh bằng cách bán CCU rẻ hơn nữa**.
   Phải cạnh tranh bằng thứ Colyseus không có: auth + DB + storage + leaderboard + dashboard trong một gói,
   tức là đúng luận điểm "Supabase cho game".

---

## 4. Kinh tế đơn vị (unit economics)

### 4.1 Chi phí sinh một game bằng AI

Giá token hiện hành: Opus 5 **$5 vào / $25 ra** mỗi triệu token; Sonnet 5 **$2 / $10**; Haiku 4.5 **$1 / $5**.
Prompt caching làm phần prefix lặp lại (template + typing SDK) rẻ đi nhiều lần; Batch API giảm 50% cho việc
không cần realtime.

Ước tính một lần sinh game hoàn chỉnh (spec + build + 2 vòng fix):

| Giai đoạn | Token vào | Token ra | Sonnet 5 | Opus 5 |
|---|---|---|---|---|
| Spec | 5K | 2K | $0,03 | $0,08 |
| Build | 40K (phần lớn cached) | 20K | $0,28 | $0,70 |
| 2 vòng fix | 60K | 12K | $0,24 | $0,60 |
| **Tổng/game** | | | **~$0,55** | **~$1,38** |
| Một lần sửa nhỏ (patch) | 20K | 4K | ~$0,08 | ~$0,20 |

Cộng chi phí verify harness (headless browser vài chục giây) → thực tế **$0,6–2,0 cho một game sinh mới**,
**$0,1–0,3 cho một lần sửa**.

> **Hệ quả về giá:** gói $19/tháng chịu được khoảng **20–30 lần sinh mới + vài trăm lần sửa** trước khi lỗ
> gộp. Vậy credit không phải trò marketing — nó là **hàng rào chi phí bắt buộc**. Định tuyến Sonnet cho
> build thường, Opus chỉ cho spec và cho game phức tạp, là đòn bẩy biên lợi nhuận lớn nhất phía Forge.

### 4.2 Chi phí chạy realtime — chỗ dễ chết nhất

Giả định (**phải benchmark ở M1, chưa đo**): game 2D, 30Hz, state ≤64KB, 1 vCPU gánh ~300 CCU.

- Compute: VM 4 vCPU/8GB ≈ $40/tháng → ~1.200 CCU → **~$0,03/CCU/tháng**.
- **Băng thông là biến số giết mô hình.** 5 KB/s mỗi kết nối → 100 CCU trung bình ≈ **1,3 TB egress/tháng**.
  - Trên **AWS** ($0,09/GB): **~$117/tháng chỉ riêng egress** cho một game nhỏ. Mô hình chết.
  - Trên **Hetzner/OVH** (20TB kèm theo) hoặc **Cloudflare** (egress $0): **≈ $0**.

**Quyết định chiến lược, không phải quyết định kỹ thuật: không được đặt runtime trên AWS/GCP trả egress theo GB.**
Đây là điều kiện cần để tồn tại, phải chốt trước khi viết dòng hạ tầng đầu tiên. (Ghi chú: user đang có sẵn
tài khoản AWS — đừng dùng nó cho tầng realtime.)

Với hạ tầng egress rẻ, biên lợi nhuận gộp mục tiêu **80–90%** — ngang chuẩn SaaS hạ tầng. Nếu benchmark M1
cho ra < 150 CCU/vCPU thì phải thiết kế lại state sync trước khi bán, chứ không phải tăng giá.

---

## 5. Mô hình giá đề xuất

Nguyên tắc: **một trục đo duy nhất mà khách hiểu được** (CCU đỉnh), credit AI là trục phụ, mọi thứ khác
không giới hạn để khỏi phải giải thích.

| Gói | Giá | CCU đỉnh | MAU | Game | AI credit/tháng | Đối tượng |
|---|---|---|---|---|---|---|
| **Free** | $0 | **100** | 10.000 | 1 công khai | ~15 lần sinh | Hobbyist, game jam, sinh viên. *Bằng Photon, và không cắt như PlayFab.* |
| **Indie** | **$19**/th | 500 | 100.000 | 5 | ~40 lần sinh | Solo dev có game thật đang chạy |
| **Studio** | **$99**/th | 2.000 | không giới hạn | 20 | ~150 lần sinh | Team nhỏ, game đã có doanh thu |
| **Scale** | từ **$399**/th | tuỳ chỉnh | — | — | tuỳ chỉnh | Có SLA, hỗ trợ ưu tiên |

**Neo giá so với đối thủ:** Indie $19 cho 500 CCU đứng cạnh Photon $125/tháng cho cùng 500 CCU — nhưng
**đừng bán bằng lý do "rẻ hơn 6 lần"**. Photon bán netcode cho game Unity/console; ta bán trọn gói backend
cho web game. Bán bằng **phạm vi** ("một gói thay cho auth + DB + realtime + leaderboard"), không bán bằng giá,
vì bán bằng giá thì Colyseus $15 sẽ nuốt ta ngay.

**Ba quy tắc kỷ luật về giá:**
1. **Không tính tiền theo MAU.** PlayFab vừa tự bắn vào chân mình bằng cách siết đúng chỗ đó; ta lấy điều
   ngược lại làm điểm bán hàng.
2. **Free tier không bao giờ ngủ và không bao giờ bị cắt hồi tố.** Đây là lời hứa thương hiệu duy nhất
   đáng giữ trong thị trường vừa bị PlayFab phá vỡ niềm tin.
3. **Overage mềm**: vượt CCU thì thắt băng thông và cảnh báo, không khoá phòng đang chơi. Người chơi thật
   không được là con tin của hoá đơn.

**Doanh thu phụ (chỉ sau khi core sống):** template/asset pack trả phí, "arcade" công khai chia doanh thu
quảng cáo. Nói thẳng: quảng cáo web game eCPM thấp, đây **không phải** trụ doanh thu, đừng lập kế hoạch dựa vào nó.

---

## 6. Ba kịch bản 24 tháng

Giả định chung: ra mắt Free + Indie ở tháng 6; tỉ lệ free→paid của dev tool 1–4%; churn tháng 3–5%.

| | **Bear** | **Base** | **Bull** |
|---|---|---|---|
| Signup free (T24) | 800 | 3.000 | 12.000 |
| Tỉ lệ trả phí | 1% | 4% | 6% |
| Khách trả tiền | 8 | 120 | 720 |
| ARPU/tháng | $19 | $35 | $48 |
| **MRR (T24)** | **$150** | **$4.200** | **$34.500** |
| **ARR** | $1,8K | **$50K** | **$414K** |
| Biên gộp | 60% | 80% | 85% |
| Lợi nhuận/năm (1 người, chi phí thấp) | ~0 | **~$35K** | ~$300K |
| **Định giá** (bội số ARR theo phân khúc) | ~0 (tài sản portfolio) | 2,5–3× → **$125–150K** | 4–5× → **$1,6–2,0M** |

Bội số dùng ở trên: micro-SaaS dưới $500K ARR nén về **2–3× ARR** (vì người mua là cá nhân, không phải quỹ);
bootstrapped $1–5M ARR đạt **4–6×**; chỉ khi Rule of 40 > 50 và NRR > 120% mới chạm 7–9×.

**Điều gì phải đúng để ra Bull, không phải Base:**
- Bắt được làn sóng rời PlayFab **trong 2 quý tới** (sau đó họ đã chọn nhà khác rồi).
- Có ít nhất **1 game của người khác** đạt vài nghìn CCU trên platform → làm case study và kéo NRR lên
  (khách lớn lên thì hoá đơn lớn lên — đây là lý do duy nhất NRR > 100% trong mô hình này).
- Forge tạo được vòng lan truyền: game sinh ra được share link → người chơi thấy "made with Arcade" → tự thành dev.
  Đây là kênh acquisition **duy nhất** có chi phí gần bằng 0 mà ta có.

---

## 7. Ra thị trường (GTM) — 100 khách đầu tiên

Theo thứ tự chi phí thấp → cao. Không làm quảng cáo trả tiền trong 12 tháng đầu; ARPU $19–35 không nuôi nổi CAC quảng cáo.

1. **Đánh trúng làn sóng PlayFab** — viết đúng một bài "Chuyển từ PlayFab sang X: hướng dẫn + script migrate
   save/leaderboard", đăng vào r/gamedev, HN, các Discord indie. Nội dung này có ý định mua rõ ràng nhất.
2. **3 game đang chạy làm chứng cứ sống.** tank/rumba/castle đã live trên `*.bomclaw.org`. Đây không phải
   demo — là bằng chứng platform chạy thật. Mỗi game gắn "made with Arcade" ở góc.
3. **Open-source phần SDK + template** (không open-source control plane). Giống chiến lược Colyseus:
   OSS làm phễu, cloud làm doanh thu. Với người mua là indie nghèo, OSS là điều kiện để được tin.
4. **Game jam**: tài trợ hạ tầng miễn phí cho jam, mỗi jam ra vài chục game chạy trên platform.
5. **Vòng lan truyền của Forge** — mỗi game sinh ra có link chia sẻ; đây là kênh rẻ nhất, nhưng chỉ hoạt động
   sau khi harness đủ tốt để game sinh ra không nhàm.

---

## 8. Ba lựa chọn chiến lược — chọn một

Là CEO thì phải chọn, không được làm cả ba.

| | **A. BaaS cho dev** (Supabase cho game) | **B. Forge cho người không code** (Rosebud) | **C. Ngách Việt Nam / Zalo Mini App** |
|---|---|---|---|
| Khách hàng | Indie dev web/HTML5 | Người muốn có game mà không code | Studio/agency VN làm game Mini App |
| Doanh thu | Subscription hạ tầng | Credit | Subscription + làm dự án |
| Bội số định giá | **4–6×** (có switching cost) | **1–2,5×** (không hào) | 3–4× nhưng dòng tiền sớm |
| Đối thủ | Colyseus, Nakama, PlayFab | Rosebud + hàng nghìn tool AI | Gần như không có tay chơi quốc tế |
| Rủi ro lớn nhất | Thị trường ARPU thấp, khách nghèo | Bị model tốt hơn nuốt bất kỳ lúc nào | TAM nhỏ, phụ thuộc một nền tảng (Zalo) |
| Hợp với 1 người? | Vừa sức nếu giữ scope chặt | Đốt tiền token, khó cầm cự | **Hợp nhất** — có lợi thế địa phương, bán được cả dịch vụ |

**Khuyến nghị:** đi **A làm sản phẩm, B làm phễu**, và **giữ C như đường lui có doanh thu sớm**.
Cụ thể: xây Runtime (A) trước, dùng Forge (B) làm kênh lan truyền và làm demo bán hàng, và nếu sau
6 tháng A không có tín hiệu trả tiền thì xoay sang C — nơi có ít cạnh tranh và có thể bán kèm dịch vụ
để sống trong lúc sản phẩm chín. Không làm A và B như hai sản phẩm song song: một người không đủ.

---

## 9. Cổng quyết định (kill criteria)

Đặt trước, để sau này không tự lừa mình:

| Mốc | Đo cái gì | Nếu trượt thì |
|---|---|---|
| M1 (~tháng 3) | Benchmark: **CCU/vCPU ≥ 150** với tank-battle thật; p99 tick < 8ms | Thiết kế lại state sync **trước khi** bán. Không tăng giá để bù. |
| M2 (~tháng 5) | **10 người ngoài** tự deploy 1 game lên platform mà không cần ta hỗ trợ | Vấn đề là DX, không phải marketing. Dừng làm feature, sửa onboarding. |
| M3 (~tháng 8) | **10 khách trả tiền** đầu tiên, tự tìm đến từ nội dung (không phải bạn bè) | Định vị sai. Cân nhắc xoay sang phương án C. |
| M4 (~tháng 12) | **$1.000 MRR**, churn < 5%/tháng | Chấp nhận đây là portfolio piece + công cụ cá nhân, ngừng đầu tư thời gian toàn phần. |
| Bất kỳ lúc nào | Chi phí token/khách trả phí > 30% doanh thu của khách đó | Siết credit hoặc đổi định tuyến model. Đây là dấu hiệu sớm nhất của lỗ gộp. |

---

## 10. Rủi ro lớn nhất (xếp theo khả năng giết dự án)

1. **Khách hàng không có tiền.** 50% game Steam kiếm < $250. Đây là rủi ro số 1 và không sửa được bằng
   sản phẩm — chỉ sửa được bằng chọn đúng phân khúc (studio nhỏ có doanh thu, không phải hobbyist).
2. **Egress ăn hết biên lợi nhuận** nếu chọn sai nhà cung cấp. Sửa được, nhưng phải sửa từ ngày đầu.
3. **Một người không kham nổi cả A và B.** Rủi ro thực thi lớn hơn rủi ro thị trường ở đây.
4. **Cửa sổ PlayFab đóng lại** trước khi ta có sản phẩm bán được. Đây là lý do M0–M1 phải nhanh hơn là đẹp.
5. **Forge bị commodity hoá** — model tốt hơn ra mỗi quý, ai cũng sinh được game. Đã tính vào chiến lược
   (Forge là phễu, không phải sản phẩm), nhưng nếu ai đó gộp cả Forge + backend miễn phí thì phải phản ứng nhanh.

---

## Nguồn

- [Colyseus Pricing](https://colyseus.io/pricing/) · [Colyseus Cloud pricing & billing](https://docs.colyseus.io/cloud/pricing-billing)
- [Heroic Labs / Nakama pricing](https://heroiclabs.com/pricing/)
- [Photon Pricing & CCU Plans](https://doc.photonengine.com/photon/current/pricing) · [Photon Fusion pricing](https://www.photonengine.com/fusion/pricing)
- [PlayFab pricing](https://developer.microsoft.com/en-us/games/products/playfab/pricing/) · [PlayFab cắt free tier 100K → 1K, 3/2026](https://crux.supercraft.host/blog/playfab-cut-free-tier-99-percent-foundation-mode-fix-2026/)
- [Supabase pricing 2026](https://uibakery.io/blog/supabase-pricing)
- [Rosebud AI pricing 2026](https://www.summerengine.com/blog/rosebud-ai-pricing)
- [Game BaaS market size](https://growthmarketreports.com/report/game-backend-as-a-service-market)
- [HTML5 games market](https://www.businessresearchinsights.com/market-reports/html5-games-market-122374) · [Browser games market](https://www.thebusinessresearchcompany.com/report/browser-games-global-market-report)
- [Indie developer market 2026](https://fungies.io/indie-developer-market-analysis-2026-2/) · [Game dev workforce stats](https://voxbooster.com/blog/game-development-statistics-2026/)
- [SaaS valuation multiples 2026](https://bigideasdb.com/saas-valuation-multiples-2026) · [Bootstrapped SaaS valuation 2026](https://saasvaluationmultiple.com/stages/bootstrapped-saas-valuation)
- Giá token Claude: Opus 5 $5/$25, Sonnet 5 $2/$10, Haiku 4.5 $1/$5 mỗi triệu token (bảng giá hiện hành trong skill `claude-api`)
