#!/usr/bin/env python3
"""
cap-nhat-roadmap-sheet.py — Dựng và cập nhật file Roadmap & Checklist trên Drive.

Sáu tab, đi từ tổng quan xuống chi tiết đúng thứ tự người đọc cần:

    1. Tổng quan          — số liệu toàn cục, đọc 30 giây biết đang ở đâu
    2. Báo cáo theo module— mỗi module xong bao nhiêu phần trăm
    3. Roadmap            — kế hoạch theo giai đoạn
    4. Checklist module   — hạng mục chi tiết
    5. Việc tồn & rủi ro  — thứ đang chặn, ai cần quyết
    6. Hướng dẫn          — quy ước trạng thái và cách dùng

Hai tab báo cáo đầu KHÔNG phải số chép tay mà là công thức COUNTIFS trỏ vào
hai tab dữ liệu. Đổi một ô trạng thái ở Checklist là toàn bộ báo cáo đổi
theo — báo cáo chép tay thì hôm sau đã sai mà không ai biết.

Ghi đè đúng vùng dữ liệu của file có sẵn nên đường dẫn Sheet không đổi.
Ở hai tab dữ liệu, script chỉ ghi các cột hệ thống quản và CHỪA cột Phụ
trách / Hoàn thành / Ghi chú cho người dùng: phân công và ngày tháng là thứ
chỉ đội ngũ mới biết, ghi đè lên đó là xoá mất công sức của họ.

Khoá service account đọc từ GOOGLE_SHEETS_KEY, mặc định
~/.config/chatmql/sheets-key.json — để NGOÀI kho mã, không bao giờ commit.

Dùng:  python3 cap-nhat-roadmap-sheet.py
"""
import os
import sys

from google.oauth2 import service_account
from googleapiclient.discovery import build

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from du_lieu_roadmap import CHECKLIST, ROADMAP, TON_DONG, TRANG_THAI, UU_TIEN  # noqa: E402

SHEET_ID = "1tpknlLcpxn6-Ms4z6D5oncaxyqGJA7t5IFsrzJpY2gk"
PHAM_VI = "https://www.googleapis.com/auth/spreadsheets"
KEY_PATH = os.environ.get(
    "GOOGLE_SHEETS_KEY", os.path.expanduser("~/.config/chatmql/sheets-key.json")
)

XANH = {"red": 0.12, "green": 0.44, "blue": 0.36}
TRANG = {"red": 1, "green": 1, "blue": 1}
NHAT = {"red": 0.92, "green": 0.95, "blue": 0.94}

MAU_TT = {
    "Xong": {"red": 0.78, "green": 0.90, "blue": 0.79},
    "Đang làm": {"red": 1.00, "green": 0.88, "blue": 0.70},
    "Chờ phụ thuộc": {"red": 1.00, "green": 0.98, "blue": 0.77},
    "Chưa bắt đầu": {"red": 0.93, "green": 0.94, "blue": 0.95},
    "Tạm dừng": {"red": 1.00, "green": 0.80, "blue": 0.82},
}

TAB_TONG_QUAN = "Tổng quan"
TAB_BAO_CAO = "Báo cáo theo module"
TAB_ROADMAP = "Roadmap"
TAB_CHECKLIST = "Checklist module"
TAB_TON = "Việc tồn & rủi ro"
TAB_HD = "Hướng dẫn"

# Cột hệ thống ghi; phần còn lại chừa cho người dùng.
GHI_ROADMAP = 6      # A–F, chừa G–J (Phụ trách, Bắt đầu, Hoàn thành, Ghi chú)
GHI_CHECKLIST = 4    # A–D, chừa E–F (Phụ trách, Ghi chú)
GHI_TON = 6          # A–F, chừa G (Ghi chú)


# ── Nội dung từng tab ───────────────────────────────────────────────

def bang_roadmap() -> list[list[str]]:
    dau = ["Giai đoạn", "Module", "Hạng mục", "Kết quả cần đạt", "Trạng thái", "Ưu tiên"]
    return [dau] + [list(r[:GHI_ROADMAP]) for r in ROADMAP]


def bang_checklist() -> list[list[str]]:
    dau = ["Module", "Nhóm chức năng", "Hạng mục", "Trạng thái"]
    return [dau] + [list(r[:GHI_CHECKLIST]) for r in CHECKLIST]


def bang_ton() -> list[list[str]]:
    dau = ["Loại", "Vấn đề", "Ảnh hưởng nếu để nguyên", "Cần làm gì", "Mức độ", "Trạng thái"]
    return [dau] + [list(r[:GHI_TON]) for r in TON_DONG]


def bang_tong_quan(n_road: int, n_check: int, n_ton: int, S: str):
    """
    Toàn bộ là công thức: báo cáo chép tay thì hôm sau đã sai.

    `S` là dấu phân cách tham số của hàm, phụ thuộc locale của file: bảng đặt
    tiếng Việt dùng dấu chấm phẩy, tiếng Anh dùng dấu phẩy. Ghi cứng một loại
    là công thức hỏng sạch ở nửa số người dùng.
    """
    r_tt = f"'{TAB_ROADMAP}'!$E$2:$E${n_road + 1}"
    c_tt = f"'{TAB_CHECKLIST}'!$D$2:$D${n_check + 1}"
    t_md = f"'{TAB_TON}'!$E$2:$E${n_ton + 1}"
    t_tt = f"'{TAB_TON}'!$F$2:$F${n_ton + 1}"

    rows: list[list[str]] = [
        ["ROADMAP & CHECKLIST CHATMQL", "", "", "", ""],
        ["Số liệu tự tính từ các tab dữ liệu. Đổi một ô Trạng thái là bảng này đổi theo.", "", "", "", ""],
        ["", "", "", "", ""],
        ["MỨC ĐỘ HOÀN THÀNH", "", "", "", ""],
        ["Tổng số hạng mục", f"={n_road}+{n_check}", "", "Việc mức Cao đang tồn",
         f'=COUNTIFS({t_md}{S}"Cao"{S}{t_tt}{S}"<>Xong")'],
        ["Đã xong", f'=COUNTIF({r_tt}{S}"Xong")+COUNTIF({c_tt}{S}"Xong")', "",
         "Việc đang chờ bên ngoài",
         f'=COUNTIF({r_tt}{S}"Chờ phụ thuộc")+COUNTIF({c_tt}{S}"Chờ phụ thuộc")'],
        ["Tỷ lệ hoàn thành", f"=IF(B5=0{S}0{S}B6/B5)", "", "Việc chưa ai nhận",
         f'=COUNTIF({r_tt}{S}"Chưa bắt đầu")+COUNTIF({c_tt}{S}"Chưa bắt đầu")'],
        ["", "", "", "", ""],
        ["THEO TRẠNG THÁI", "Roadmap", "Checklist", "Tổng", "Tỷ lệ"],
    ]
    hang_dau_tt = len(rows) + 1
    for i, tt in enumerate(TRANG_THAI):
        r = hang_dau_tt + i
        rows.append([tt, f'=COUNTIF({r_tt}{S}$A{r})', f'=COUNTIF({c_tt}{S}$A{r})',
                     f"=B{r}+C{r}", f"=IF($B$5=0{S}0{S}D{r}/$B$5)"])
    hang_cuoi_tt = hang_dau_tt + len(TRANG_THAI) - 1

    rows.append(["Tổng cộng",
                 f"=SUM(B{hang_dau_tt}:B{hang_cuoi_tt})",
                 f"=SUM(C{hang_dau_tt}:C{hang_cuoi_tt})",
                 f"=SUM(D{hang_dau_tt}:D{hang_cuoi_tt})",
                 f"=IF($B$5=0{S}0{S}D{hang_cuoi_tt + 1}/$B$5)"])
    rows.append(["", "", "", "", ""])

    rows.append(["TIẾN ĐỘ THEO GIAI ĐOẠN", "Tổng", "Xong", "Còn lại", "Tỷ lệ"])
    hang_gd = len(rows) + 1
    giai_doan: list[str] = []
    for r in ROADMAP:
        if r[0] not in giai_doan:
            giai_doan.append(r[0])
    r_gd = f"'{TAB_ROADMAP}'!$A$2:$A${n_road + 1}"
    for i, gd in enumerate(giai_doan):
        r = hang_gd + i
        rows.append([gd, f'=COUNTIF({r_gd}{S}$A{r})',
                     f'=COUNTIFS({r_gd}{S}$A{r}{S}{r_tt}{S}"Xong")',
                     f"=B{r}-C{r}", f"=IF(B{r}=0{S}0{S}C{r}/B{r})"])

    rows.append(["", "", "", "", ""])
    rows.append(["VIỆC MỨC CAO CHƯA XONG — xem chi tiết ở tab Việc tồn & rủi ro", "", "", "", ""])
    hang_ton = len(rows) + 1
    rows.append([
        f'=IFERROR(TEXTJOIN(CHAR(10){S}TRUE{S}FILTER(\'{TAB_TON}\'!B2:B{n_ton + 1}{S}'
        f'\'{TAB_TON}\'!E2:E{n_ton + 1}="Cao"{S}\'{TAB_TON}\'!F2:F{n_ton + 1}<>"Xong")){S}'
        f'"Không còn việc mức Cao nào.")', "", "", "", ""])
    return rows, hang_dau_tt, hang_cuoi_tt, hang_gd, len(giai_doan), hang_ton


def bang_bao_cao(n_check: int, S: str) -> tuple[list[list[str]], int, int]:
    """Mỗi module một dòng, số liệu bám theo tab Checklist."""
    mod_r = f"'{TAB_CHECKLIST}'!$A$2:$A${n_check + 1}"
    tt_r = f"'{TAB_CHECKLIST}'!$D$2:$D${n_check + 1}"

    modules: list[str] = []
    for r in CHECKLIST:
        if r[0] not in modules:
            modules.append(r[0])

    rows: list[list[str]] = [
        ["TIẾN ĐỘ TỪNG MODULE", "", "", "", "", "", ""],
        ["Bám theo tab Checklist module. Sửa trạng thái bên đó, bảng này tự đổi.", "", "", "", "", "", ""],
        ["", "", "", "", "", "", ""],
        ["Module", "Tổng hạng mục", "Xong", "Đang làm", "Chờ phụ thuộc", "Chưa bắt đầu", "Tỷ lệ xong"],
    ]
    dau = len(rows) + 1
    for i, m in enumerate(modules):
        r = dau + i
        rows.append([
            m,
            f'=COUNTIF({mod_r}{S}$A{r})',
            f'=COUNTIFS({mod_r}{S}$A{r}{S}{tt_r}{S}"Xong")',
            f'=COUNTIFS({mod_r}{S}$A{r}{S}{tt_r}{S}"Đang làm")',
            f'=COUNTIFS({mod_r}{S}$A{r}{S}{tt_r}{S}"Chờ phụ thuộc")',
            f'=COUNTIFS({mod_r}{S}$A{r}{S}{tt_r}{S}"Chưa bắt đầu")',
            f"=IF(B{r}=0{S}0{S}C{r}/B{r})",
        ])
    cuoi = dau + len(modules) - 1
    rows.append(["Tổng cộng"] + [f"=SUM({c}{dau}:{c}{cuoi})" for c in "BCDEF"]
                + [f"=IF(B{cuoi + 1}=0{S}0{S}C{cuoi + 1}/B{cuoi + 1})"])
    return rows, dau, cuoi + 1


def bang_huong_dan() -> list[list[str]]:
    return [
        ["HƯỚNG DẪN DÙNG FILE", ""],
        ["", ""],
        ["Thứ tự đọc", "Tổng quan → Báo cáo theo module → rồi mới vào Roadmap hoặc Checklist khi cần chi tiết."],
        ["Cập nhật thế nào", "Chỉ sửa cột Trạng thái ở hai tab Roadmap và Checklist module. Hai tab báo cáo tự tính lại."],
        ["", ""],
        ["QUY ƯỚC TRẠNG THÁI", ""],
        ["Xong", "Đã làm, đã chạy thử, đã lên nhánh."],
        ["Đang làm", "Có người đang làm trong tuần này."],
        ["Chờ phụ thuộc", "Không làm tiếp được vì đợi bên ngoài: API, dữ liệu, quyết định của lãnh đạo."],
        ["Chưa bắt đầu", "Đã thống nhất làm nhưng chưa ai nhận."],
        ["Tạm dừng", "Có chủ ý dừng lại, ghi rõ lý do ở cột Ghi chú."],
        ["", ""],
        ["QUY ƯỚC MỨC ĐỘ", ""],
        ["Cao", "Chặn việc khác hoặc có rủi ro thật. Không để quá một tuần mà không động tới."],
        ["Trung bình", "Cần làm nhưng chưa chặn ai."],
        ["Thấp", "Làm khi rảnh."],
        ["", ""],
        ["CỘT NÀO CỦA AI", ""],
        ["Hệ thống ghi", "Giai đoạn, Module, Hạng mục, Kết quả, Trạng thái, Ưu tiên — bị ghi đè mỗi lần cập nhật."],
        ["Của đội ngũ", "Phụ trách, Bắt đầu, Hoàn thành, Ghi chú — không bao giờ bị ghi đè, cứ điền thoải mái."],
        ["", ""],
        ["Người phụ trách", "Ghi tên một người duy nhất. Việc không có tên là việc không ai làm."],
        ["Ngày hoàn thành", "Chỉ điền khi chuyển sang Xong, để nhìn lại tốc độ thực tế."],
    ]


# ── Dựng bảng trên Google Sheet ─────────────────────────────────────

def yc_tieu_de(sid: int, hang: int, so_cot: int) -> list[dict]:
    return [{"repeatCell": {
        "range": {"sheetId": sid, "startRowIndex": hang, "endRowIndex": hang + 1,
                  "startColumnIndex": 0, "endColumnIndex": so_cot},
        "cell": {"userEnteredFormat": {
            "backgroundColor": XANH,
            "textFormat": {"bold": True, "foregroundColor": TRANG},
            "verticalAlignment": "MIDDLE"}},
        "fields": "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)"}}]


def yc_rong_cot(sid: int, rong: list[int]) -> list[dict]:
    return [{"updateDimensionProperties": {
        "range": {"sheetId": sid, "dimension": "COLUMNS", "startIndex": i, "endIndex": i + 1},
        "properties": {"pixelSize": w}, "fields": "pixelSize"}} for i, w in enumerate(rong)]


def yc_mau_trang_thai(sid: int, cot: int, tu_hang: int, den_hang: int) -> list[dict]:
    return [{"addConditionalFormatRule": {"index": 0, "rule": {
        "ranges": [{"sheetId": sid, "startRowIndex": tu_hang, "endRowIndex": den_hang,
                    "startColumnIndex": cot, "endColumnIndex": cot + 1}],
        "booleanRule": {
            "condition": {"type": "TEXT_EQ", "values": [{"userEnteredValue": tt}]},
            "format": {"backgroundColor": mau}}}}}
        for tt, mau in MAU_TT.items()]


def yc_chon_mot_trong(sid: int, cot: int, tu_hang: int, den_hang: int,
                      lua_chon: list[str]) -> list[dict]:
    return [{"setDataValidation": {
        "range": {"sheetId": sid, "startRowIndex": tu_hang, "endRowIndex": den_hang,
                  "startColumnIndex": cot, "endColumnIndex": cot + 1},
        "rule": {"condition": {"type": "ONE_OF_LIST",
                               "values": [{"userEnteredValue": v} for v in lua_chon]},
                 "showCustomUi": True, "strict": False}}}]


def main() -> int:
    if not os.path.exists(KEY_PATH):
        print(f"Chưa thấy khoá tại {KEY_PATH}")
        return 1

    cred = service_account.Credentials.from_service_account_file(KEY_PATH, scopes=[PHAM_VI])
    api = build("sheets", "v4", credentials=cred).spreadsheets()

    # Locale quyết định dấu phân cách tham số trong công thức.
    thuoc_tinh = api.get(spreadsheetId=SHEET_ID, fields="properties").execute()["properties"]
    S = ";" if thuoc_tinh.get("locale", "").startswith("vi") else ","

    n_road, n_check, n_ton = len(ROADMAP), len(CHECKLIST), len(TON_DONG)
    tq, tt_dau, tt_cuoi, gd_dau, gd_so, ton_hang = bang_tong_quan(n_road, n_check, n_ton, S)
    bc, bc_dau, bc_cuoi = bang_bao_cao(n_check, S)

    can = [TAB_TONG_QUAN, TAB_BAO_CAO, TAB_ROADMAP, TAB_CHECKLIST, TAB_TON, TAB_HD]

    # Tạo tab còn thiếu, đặt đúng thứ tự. Tab cũ giữ nguyên id để không mất
    # những gì người dùng đã điền ở các cột bên phải.
    meta = api.get(spreadsheetId=SHEET_ID).execute()
    hien_co = {s["properties"]["title"]: s["properties"]["sheetId"] for s in meta["sheets"]}

    # Tab đầu tiên của file (tên cũ bất kỳ) đổi thành tab dữ liệu Checklist.
    dau_tien = meta["sheets"][0]["properties"]
    if dau_tien["title"] not in can:
        api.batchUpdate(spreadsheetId=SHEET_ID, body={"requests": [
            {"updateSheetProperties": {
                "properties": {"sheetId": dau_tien["sheetId"], "title": TAB_CHECKLIST},
                "fields": "title"}}]}).execute()
        hien_co.pop(dau_tien["title"], None)
        hien_co[TAB_CHECKLIST] = dau_tien["sheetId"]

    them = [{"addSheet": {"properties": {"title": t}}} for t in can if t not in hien_co]
    if them:
        kq = api.batchUpdate(spreadsheetId=SHEET_ID, body={"requests": them}).execute()
        for r in kq["replies"]:
            p = r["addSheet"]["properties"]
            hien_co[p["title"]] = p["sheetId"]

    api.batchUpdate(spreadsheetId=SHEET_ID, body={"requests": [
        {"updateSheetProperties": {
            "properties": {"sheetId": hien_co[t], "index": i}, "fields": "index"}}
        for i, t in enumerate(can)]}).execute()

    sid = {t: hien_co[t] for t in can}

    # ── Ghi dữ liệu ──
    api.values().batchClear(spreadsheetId=SHEET_ID, body={"ranges": [
        f"'{TAB_TONG_QUAN}'!A1:H200", f"'{TAB_BAO_CAO}'!A1:H100",
        f"'{TAB_ROADMAP}'!A1:F1000", f"'{TAB_CHECKLIST}'!A1:D1000",
        f"'{TAB_TON}'!A1:F1000", f"'{TAB_HD}'!A1:B100",
    ]}).execute()

    api.values().batchUpdate(spreadsheetId=SHEET_ID, body={
        "valueInputOption": "USER_ENTERED",
        "data": [
            {"range": f"'{TAB_TONG_QUAN}'!A1", "values": tq},
            {"range": f"'{TAB_BAO_CAO}'!A1", "values": bc},
            {"range": f"'{TAB_ROADMAP}'!A1", "values": bang_roadmap()},
            {"range": f"'{TAB_CHECKLIST}'!A1", "values": bang_checklist()},
            {"range": f"'{TAB_TON}'!A1", "values": bang_ton()},
            {"range": f"'{TAB_HD}'!A1", "values": bang_huong_dan()},
        ]}).execute()

    # ── Định dạng ──
    yc: list[dict] = []

    # Xoá luật màu cũ trước, nếu không mỗi lần chạy lại chồng thêm một bộ.
    meta = api.get(spreadsheetId=SHEET_ID).execute()
    for s in meta["sheets"]:
        for _ in range(len(s.get("conditionalFormats", []))):
            yc.append({"deleteConditionalFormatRule":
                       {"sheetId": s["properties"]["sheetId"], "index": 0}})

    # Tổng quan
    s = sid[TAB_TONG_QUAN]
    yc += yc_rong_cot(s, [300, 130, 130, 240, 130])
    yc.append({"repeatCell": {
        "range": {"sheetId": s, "startRowIndex": 0, "endRowIndex": 1},
        "cell": {"userEnteredFormat": {"textFormat": {
            "bold": True, "fontSize": 15, "foregroundColor": XANH}}},
        "fields": "userEnteredFormat.textFormat"}})
    for h in (3, 8, tt_cuoi + 2, ton_hang - 2):  # các dòng tiêu đề nhóm
        yc.append({"repeatCell": {
            "range": {"sheetId": s, "startRowIndex": h, "endRowIndex": h + 1,
                      "startColumnIndex": 0, "endColumnIndex": 5},
            "cell": {"userEnteredFormat": {
                "backgroundColor": NHAT,
                "textFormat": {"bold": True, "foregroundColor": XANH}}},
            "fields": "userEnteredFormat(backgroundColor,textFormat)"}})
    for o in ("B7", "E10", "E11", "E12", "E13", "E14", "E15"):
        pass
    yc.append({"repeatCell": {  # tỷ lệ tổng — con số quan trọng nhất của file
        "range": {"sheetId": s, "startRowIndex": 6, "endRowIndex": 7,
                  "startColumnIndex": 1, "endColumnIndex": 2},
        "cell": {"userEnteredFormat": {
            "numberFormat": {"type": "PERCENT", "pattern": "0%"},
            "textFormat": {"bold": True, "fontSize": 18, "foregroundColor": XANH}}},
        "fields": "userEnteredFormat(numberFormat,textFormat)"}})
    yc.append({"repeatCell": {
        "range": {"sheetId": s, "startRowIndex": tt_dau - 1, "endRowIndex": tt_cuoi + 1,
                  "startColumnIndex": 4, "endColumnIndex": 5},
        "cell": {"userEnteredFormat": {"numberFormat": {"type": "PERCENT", "pattern": "0%"}}},
        "fields": "userEnteredFormat.numberFormat"}})
    yc.append({"repeatCell": {
        "range": {"sheetId": s, "startRowIndex": gd_dau - 1, "endRowIndex": gd_dau + gd_so - 1,
                  "startColumnIndex": 4, "endColumnIndex": 5},
        "cell": {"userEnteredFormat": {"numberFormat": {"type": "PERCENT", "pattern": "0%"}}},
        "fields": "userEnteredFormat.numberFormat"}})
    yc.append({"repeatCell": {  # ô liệt kê việc mức Cao: nhiều dòng trong một ô
        "range": {"sheetId": s, "startRowIndex": ton_hang - 1, "endRowIndex": ton_hang,
                  "startColumnIndex": 0, "endColumnIndex": 5},
        "cell": {"userEnteredFormat": {"wrapStrategy": "WRAP", "verticalAlignment": "TOP"}},
        "fields": "userEnteredFormat(wrapStrategy,verticalAlignment)"}})
    yc += yc_mau_trang_thai(s, 0, tt_dau - 1, tt_cuoi)

    # Báo cáo theo module
    s = sid[TAB_BAO_CAO]
    yc += yc_rong_cot(s, [200, 120, 90, 100, 130, 130, 110])
    yc.append({"repeatCell": {
        "range": {"sheetId": s, "startRowIndex": 0, "endRowIndex": 1},
        "cell": {"userEnteredFormat": {"textFormat": {
            "bold": True, "fontSize": 15, "foregroundColor": XANH}}},
        "fields": "userEnteredFormat.textFormat"}})
    yc += yc_tieu_de(s, 3, 7)
    yc.append({"repeatCell": {
        "range": {"sheetId": s, "startRowIndex": bc_dau - 1, "endRowIndex": bc_cuoi,
                  "startColumnIndex": 6, "endColumnIndex": 7},
        "cell": {"userEnteredFormat": {"numberFormat": {"type": "PERCENT", "pattern": "0%"}}},
        "fields": "userEnteredFormat.numberFormat"}})
    yc.append({"repeatCell": {
        "range": {"sheetId": s, "startRowIndex": bc_cuoi - 1, "endRowIndex": bc_cuoi,
                  "startColumnIndex": 0, "endColumnIndex": 7},
        "cell": {"userEnteredFormat": {
            "backgroundColor": NHAT, "textFormat": {"bold": True}}},
        "fields": "userEnteredFormat(backgroundColor,textFormat)"}})
    # Thanh tỷ lệ: nhìn cột màu nhanh hơn đọc bảy con số.
    yc.append({"addConditionalFormatRule": {"index": 0, "rule": {
        "ranges": [{"sheetId": s, "startRowIndex": bc_dau - 1, "endRowIndex": bc_cuoi - 1,
                    "startColumnIndex": 6, "endColumnIndex": 7}],
        "gradientRule": {
            "minpoint": {"color": {"red": 1, "green": 0.85, "blue": 0.85}, "type": "NUMBER", "value": "0"},
            "maxpoint": {"color": {"red": 0.78, "green": 0.90, "blue": 0.79}, "type": "NUMBER", "value": "1"}}}}})

    # Ba tab dữ liệu
    for tab, so_cot, cot_tt, so_dong, rong, lua_chon in (
        (TAB_ROADMAP, 6, 4, n_road, [180, 150, 260, 320, 130, 110, 120, 100, 110, 260], TRANG_THAI),
        (TAB_CHECKLIST, 4, 3, n_check, [170, 160, 340, 130, 120, 300], TRANG_THAI),
        (TAB_TON, 6, 5, n_ton, [130, 280, 300, 300, 100, 130, 220], TRANG_THAI),
    ):
        s = sid[tab]
        yc += yc_tieu_de(s, 0, so_cot)
        yc += yc_rong_cot(s, rong)
        yc.append({"updateSheetProperties": {
            "properties": {"sheetId": s, "gridProperties": {"frozenRowCount": 1}},
            "fields": "gridProperties.frozenRowCount"}})
        yc.append({"repeatCell": {
            "range": {"sheetId": s, "startRowIndex": 1, "endRowIndex": so_dong + 1},
            "cell": {"userEnteredFormat": {"wrapStrategy": "WRAP", "verticalAlignment": "TOP"}},
            "fields": "userEnteredFormat(wrapStrategy,verticalAlignment)"}})
        yc += yc_mau_trang_thai(s, cot_tt, 1, so_dong + 1)
        yc += yc_chon_mot_trong(s, cot_tt, 1, so_dong + 1, lua_chon)
        yc.append({"setBasicFilter": {"filter": {"range": {
            "sheetId": s, "startRowIndex": 0, "endRowIndex": so_dong + 1,
            "startColumnIndex": 0, "endColumnIndex": len(rong)}}}})

    yc += yc_chon_mot_trong(sid[TAB_ROADMAP], 5, 1, n_road + 1, UU_TIEN)
    yc += yc_chon_mot_trong(sid[TAB_TON], 4, 1, n_ton + 1, UU_TIEN)

    # Hướng dẫn
    s = sid[TAB_HD]
    yc += yc_rong_cot(s, [220, 760])
    yc.append({"repeatCell": {
        "range": {"sheetId": s, "startRowIndex": 0, "endRowIndex": 1},
        "cell": {"userEnteredFormat": {"textFormat": {
            "bold": True, "fontSize": 15, "foregroundColor": XANH}}},
        "fields": "userEnteredFormat.textFormat"}})
    yc.append({"repeatCell": {
        "range": {"sheetId": s, "startRowIndex": 0, "endRowIndex": 40,
                  "startColumnIndex": 0, "endColumnIndex": 1},
        "cell": {"userEnteredFormat": {"textFormat": {"bold": True}}},
        "fields": "userEnteredFormat.textFormat"}})
    yc.append({"repeatCell": {
        "range": {"sheetId": s, "startRowIndex": 0, "endRowIndex": 40,
                  "startColumnIndex": 1, "endColumnIndex": 2},
        "cell": {"userEnteredFormat": {"wrapStrategy": "WRAP", "verticalAlignment": "TOP"}},
        "fields": "userEnteredFormat(wrapStrategy,verticalAlignment)"}})

    # Múi giờ mặc định của Drive là giờ Mỹ — sai với ngày tháng đội ngũ điền.
    if thuoc_tinh.get("timeZone") != "Asia/Ho_Chi_Minh":
        yc.append({"updateSpreadsheetProperties": {
            "properties": {"timeZone": "Asia/Ho_Chi_Minh"}, "fields": "timeZone"}})

    api.batchUpdate(spreadsheetId=SHEET_ID, body={"requests": yc}).execute()

    print(f"Đã dựng {len(can)} tab: {' · '.join(can)}")
    print(f"Roadmap {n_road} · Checklist {n_check} · Việc tồn {n_ton}")
    print(f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
