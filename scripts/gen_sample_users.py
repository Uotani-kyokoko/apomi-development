# -*- coding: utf-8 -*-
"""Generate 240 sample members for apomi."""
import csv
import json
import random
from datetime import datetime, timedelta
from pathlib import Path

random.seed(42)
BASE = Path(__file__).resolve().parent.parent / "data"

LAST_NAMES = [
    "佐藤", "鈴木", "高橋", "田中", "伊藤", "渡辺", "山本", "中村", "小林", "加藤",
    "吉田", "山田", "佐々木", "山口", "松本", "井上", "木村", "林", "斎藤", "清水",
    "阿部", "池田", "森", "橋本", "山下", "石川", "中島", "前田", "藤田", "岡田",
    "後藤", "長谷川", "石井", "村上", "近藤", "坂本", "遠藤", "青木", "藤井", "西村",
    "福田", "太田", "三浦", "岡本", "松田", "中川", "中野", "原田", "小野", "田村",
    "竹内", "金子", "和田", "中山", "石田", "上田", "森田", "原", "柴田", "酒井",
]
MALE_FIRST = [
    "太郎", "健太", "大輔", "翔太", "拓也", "直樹", "誠", "剛", "亮", "裕介",
    "和也", "達也", "智也", "悠人", "蓮", "陽翔", "湊", "蒼", "陸", "颯太",
]
FEMALE_FIRST = [
    "美咲", "陽子", "恵", "彩", "真由", "愛", "優子", "美穂", "奈々", "さくら",
    "結衣", "美月", "花", "凛", "葵", "心", "芽依", "陽菜", "莉子", "美羽",
]
AGES = ["20代", "30代", "40代", "50代", "60代"]
INDUSTRIES = [
    "サービス業", "美容・健康", "建設・不動産", "飲食・サービス", "製造業",
    "IT・通信", "小売", "教育", "医療・福祉", "その他",
]
JOBS = [
    "経営者", "代表取締役", "CEO", "サロンオーナー", "専務取締役",
    "工場長", "部長", "個人事業主", "フリーランス", "その他",
]
PREFS = [
    "北海道", "宮城県", "東京都", "神奈川県", "埼玉県", "千葉県",
    "愛知県", "大阪府", "京都府", "兵庫県", "広島県", "福岡県",
    "佐賀県", "沖縄県", "静岡県", "新潟県",
]


def fmt(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def main() -> None:
    now = datetime(2026, 7, 12, 1, 0, 0)
    rows = []
    users_json = []

    for i in range(1, 241):
        mid = f"{i:05d}"
        gender = "男性" if i % 2 else "女性"
        first = random.choice(MALE_FIRST if gender == "男性" else FEMALE_FIRST)
        last = LAST_NAMES[(i - 1) % len(LAST_NAMES)]
        name = last + first
        age = AGES[(i - 1) % len(AGES)]
        industry = INDUSTRIES[(i - 1) % len(INDUSTRIES)]
        job = JOBS[(i - 1) % len(JOBS)]
        loc = PREFS[(i - 1) % len(PREFS)]
        home = PREFS[(i * 3) % len(PREFS)]
        published = i % 30 != 0  # 8 accounts stopped

        if i % 10 in (1, 2):
            pub = now - timedelta(days=random.randint(0, 6), hours=random.randint(0, 20))
        else:
            pub = now - timedelta(days=random.randint(10, 120), hours=random.randint(0, 20))

        created = pub - timedelta(days=random.randint(0, 30))
        updated = pub + timedelta(hours=random.randint(0, 48))
        last_login = updated if published else created
        online = "オンライン" if (published and i % 7 == 0) else "オフライン"
        avatar = f"https://i.pravatar.cc/150?img={1 + ((i - 1) % 70)}"
        bio = f"{industry}で活動する{job}の{name}です。会員No.{mid}として交流を楽しみにしています。"
        want = f"{industry}や関連分野で協業できる方"
        avoid = "一方的な営業のみの方"
        short_loc = loc.replace("県", "").replace("都", "").replace("府", "")
        tags = f"{industry[:2]},{job},{short_loc}"
        email = f"user{mid}@example.com"
        line = "https://line.me/" if i % 3 else ""
        instagram = "https://instagram.com/" if i % 4 else ""
        x = "https://x.com/" if i % 5 else ""
        youtube = "https://youtube.com/" if i % 6 == 0 else ""

        row = {
            "会員番号": mid,
            "Googleメール": email,
            "GoogleID": f"google-sub-{mid}",
            "名前": name,
            "性別": gender,
            "年代": age,
            "業種": industry,
            "職種": job,
            "現在地": loc,
            "出身地": home,
            "自己紹介": bio,
            "こんな人と繋がりたい": want,
            "こんな人とは繋がりたくない": avoid,
            "タグ": tags,
            "プロフィール画像URL": avatar,
            "LINE": line,
            "Instagram": instagram,
            "X": x,
            "YouTube": youtube,
            "掲載中": "TRUE" if published else "FALSE",
            "社長マーク": "FALSE",
            "社長マーク状態": "なし",
            "オンライン状態": online,
            "掲載日": fmt(pub),
            "登録日時": fmt(created),
            "更新日時": fmt(updated),
            "最終ログイン日時": fmt(last_login),
        }
        rows.append(row)
        users_json.append(
            {
                "id": mid,
                "email": email,
                "name": name,
                "gender": gender,
                "ageGroup": age,
                "industry": industry,
                "jobTitle": job,
                "location": loc,
                "hometown": home,
                "status": online,
                "publishedAt": fmt(pub),
                "createdAt": fmt(created),
                "lastLoginAt": fmt(last_login),
                "isPublished": published,
                "presidentMark": False,
                "presidentMarkStatus": "なし",
                "bio": bio,
                "wantMeet": want,
                "avoidMeet": avoid,
                "tags": [t for t in tags.split(",") if t],
                "avatarUrl": avatar,
                "sns": {
                    "line": line,
                    "instagram": instagram,
                    "x": x,
                    "youtube": youtube,
                },
            }
        )

    fields = list(rows[0].keys())
    csv_path = BASE / "会員.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)

    json_path = BASE / "sample-users-240.json"
    with json_path.open("w", encoding="utf-8") as f:
        json.dump(users_json, f, ensure_ascii=False)

    pub_count = sum(1 for r in rows if r["掲載中"] == "TRUE")
    latest = 0
    for r in rows:
        if r["掲載中"] != "TRUE":
            continue
        d = datetime.strptime(r["掲載日"], "%Y-%m-%d %H:%M:%S")
        if (now - d).days <= 7:
            latest += 1

    def band(a: int, b: int) -> int:
        return sum(
            1
            for r in rows
            if r["掲載中"] == "TRUE" and a <= int(r["会員番号"]) <= b
        )

    print(f"wrote {csv_path}")
    print(f"wrote {json_path}")
    print(f"total=240 published={pub_count} stopped={240 - pub_count}")
    print(f"latest7d={latest}")
    print(f"band1-100={band(1, 100)} 101-200={band(101, 200)} 201-240={band(201, 240)}")


if __name__ == "__main__":
    main()
