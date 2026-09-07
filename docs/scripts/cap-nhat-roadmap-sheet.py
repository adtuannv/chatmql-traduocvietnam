#!/usr/bin/env python3
"""
cap-nhat-roadmap-sheet.py — Ghi nội dung Roadmap & Checklist vào Google Sheet.

Ghi ĐÈ đúng vùng dữ liệu của file có sẵn, không tạo file mới, nên đường dẫn
Sheet không đổi và mọi thứ người dùng đã tự điền ở các cột phía sau vẫn còn.

Chỉ ghi các cột hệ thống quản (A–F) và chừa lại cột G trở đi cho người dùng:
phụ trách, ngày, ghi chú riêng là thứ chỉ đội ngũ mới biết, ghi đè lên đó là
xoá mất công sức của họ.

Cần: khoá service account đã được chia sẻ quyền chỉnh sửa vào chính file đó.
Đường dẫn khoá đọc từ biến môi trường GOOGLE_SHEETS_KEY, mặc định
~/.config/chatmql/sheets-key.json — để NGOÀI kho mã, không bao giờ commit.

Dùng:
    python3 cap-nhat-roadmap-sheet.py            # ghi dữ liệu mặc định
    python3 cap-nhat-roadmap-sheet.py duong/dan.csv   # ghi từ file CSV khác
"""
import csv
import os
import sys

from google.oauth2 import service_account
from googleapiclient.discovery import build

SHEET_ID = "1tpknlLcpxn6-Ms4z6D5oncaxyqGJA7t5IFsrzJpY2gk"
TEN_TAB = "ChatMQL — Roadmap & Checklist module"
PHAM_VI = "https://www.googleapis.com/auth/spreadsheets"

KEY_PATH = os.environ.get(
    "GOOGLE_SHEETS_KEY",
    os.path.expanduser("~/.config/chatmql/sheets-key.json"),
)

# Cột hệ thống quản. Cột G trở đi (Phụ trách, Hoàn thành, Ghi chú) là của
# người dùng — script không đụng tới.
COT_HE_THONG = 6


def doc_du_lieu(duong_dan: str) -> list[list[str]]:
    with open(duong_dan, encoding="utf-8") as f:
        return [hang[:COT_HE_THONG] for hang in csv.reader(f)]


# Màu nền theo trạng thái, khớp quy ước trong file: xanh là xong, cam là đang
# làm, vàng là đợi bên ngoài, xám là chưa ai nhận, đỏ là dừng có chủ ý.
MAU_TRANG_THAI = {
    "Xong": (0.78, 0.90, 0.79),
    "Đang làm": (1.00, 0.88, 0.70),
    "Chờ phụ thuộc": (1.00, 0.98, 0.77),
    "Chưa bắt đầu": (0.93, 0.94, 0.95),
    "Tạm dừng": (1.00, 0.80, 0.82),
}


def dinh_dang(sheets, sheet_id: int, so_dong: int) -> None:
    """Đóng băng tiêu đề, chỉnh cột, tô màu trạng thái. Chạy lại được nhiều lần."""
    rong = [110, 190, 150, 300, 340, 120, 100, 120, 110, 260]
    yeu_cau: list[dict] = [
        {"updateSheetProperties": {
            "properties": {"sheetId": sheet_id, "title": "Roadmap & Checklist",
                           "gridProperties": {"frozenRowCount": 1}},
            "fields": "title,gridProperties.frozenRowCount"}},
        {"repeatCell": {
            "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1},
            "cell": {"userEnteredFormat": {
                "backgroundColor": {"red": 0.12, "green": 0.44, "blue": 0.36},
                "textFormat": {"bold": True, "foregroundColor": {"red": 1, "green": 1, "blue": 1}},
                "verticalAlignment": "MIDDLE"}},
            "fields": "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)"}},
        # Xuống dòng trong ô: mô tả dài mà cắt cụt thì mất nghĩa.
        {"repeatCell": {
            "range": {"sheetId": sheet_id, "startRowIndex": 1, "endRowIndex": so_dong},
            "cell": {"userEnteredFormat": {"wrapStrategy": "WRAP", "verticalAlignment": "TOP"}},
            "fields": "userEnteredFormat(wrapStrategy,verticalAlignment)"}},
        {"setBasicFilter": {"filter": {"range": {
            "sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": so_dong,
            "startColumnIndex": 0, "endColumnIndex": 10}}}},
    ]
    for i, w in enumerate(rong):
        yeu_cau.append({"updateDimensionProperties": {
            "range": {"sheetId": sheet_id, "dimension": "COLUMNS",
                      "startIndex": i, "endIndex": i + 1},
            "properties": {"pixelSize": w}, "fields": "pixelSize"}})

    # Xoá luật màu cũ trước khi đặt lại, nếu không mỗi lần chạy lại chồng thêm.
    meta = sheets.get(spreadsheetId=SHEET_ID, ranges=[], includeGridData=False).execute()
    so_luat = len(meta["sheets"][0].get("conditionalFormats", []))
    for _ in range(so_luat):
        yeu_cau.append({"deleteConditionalFormatRule": {"sheetId": sheet_id, "index": 0}})

    for tt, (r, g, b) in MAU_TRANG_THAI.items():
        yeu_cau.append({"addConditionalFormatRule": {"index": 0, "rule": {
            "ranges": [{"sheetId": sheet_id, "startRowIndex": 1, "endRowIndex": so_dong,
                        "startColumnIndex": 5, "endColumnIndex": 6}],
            "booleanRule": {
                "condition": {"type": "TEXT_EQ", "values": [{"userEnteredValue": tt}]},
                "format": {"backgroundColor": {"red": r, "green": g, "blue": b}}}}}})

    sheets.batchUpdate(spreadsheetId=SHEET_ID, body={"requests": yeu_cau}).execute()


def main() -> int:
    if not os.path.exists(KEY_PATH):
        print(f"Chưa thấy khoá tại {KEY_PATH}")
        print("Đặt biến GOOGLE_SHEETS_KEY trỏ tới file khoá, hoặc chép khoá vào đường dẫn trên.")
        return 1

    nguon = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "roadmap-chatmql.csv"
    )
    if not os.path.exists(nguon):
        print(f"Chưa thấy dữ liệu nguồn: {nguon}")
        return 1

    du_lieu = doc_du_lieu(nguon)
    if not du_lieu:
        print("Dữ liệu nguồn rỗng — dừng lại thay vì xoá trắng sheet.")
        return 1

    cred = service_account.Credentials.from_service_account_file(KEY_PATH, scopes=[PHAM_VI])
    sheets = build("sheets", "v4", credentials=cred).spreadsheets()

    # Tên tab thật của file (tab đầu tiên) — Drive đặt theo tên file khi nhập CSV.
    meta = sheets.get(spreadsheetId=SHEET_ID).execute()
    tab = meta["sheets"][0]["properties"]["title"]

    # Xoá vùng cũ trước: nếu bản mới ít dòng hơn, phần thừa phải biến mất chứ
    # không nằm lại thành dữ liệu ma.
    sheets.values().clear(
        spreadsheetId=SHEET_ID,
        range=f"'{tab}'!A1:F10000",
    ).execute()

    kq = sheets.values().update(
        spreadsheetId=SHEET_ID,
        range=f"'{tab}'!A1",
        valueInputOption="RAW",
        body={"values": du_lieu},
    ).execute()

    dinh_dang(sheets, meta["sheets"][0]["properties"]["sheetId"], len(du_lieu))

    print(f"Đã ghi {kq.get('updatedRows', len(du_lieu))} dòng vào tab '{tab}'.")
    print(f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
