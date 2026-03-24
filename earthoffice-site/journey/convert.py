import pandas as pd
import json

# Adjust filename as needed
EXCEL_FILE = "prompt data.xlsx"
OUTPUT_JSON = "prompts.json"

def main():
    # Read the Excel file
    df = pd.read_excel(EXCEL_FILE)

    # If your first row contains the headers as data, uncomment the next two lines:
    # new_header = df.iloc[0]
    # df = df[1:].copy(); df.columns = new_header

    # Rename columns to safe JSON-friendly names if needed
    df = df.rename(columns={
        "PromptID": "PromptID",
        "PromptDate": "PromptDate",
        "HRT days": "HRTDays",
        "Class": "Class",
        "Phase": "Phase",
        "PromptText": "PromptText",
        "SourceFileID": "SourceFileID",
        "Tags": "Tags"
    })

    records = []
    for _, row in df.iterrows():
        # Skip header-like rows if needed
        if str(row.get("PromptID")).lower() == "promptid":
            continue

        # Split tags on comma, strip whitespace
        tags_raw = str(row.get("Tags", "") or "")
        tags = [t.strip() for t in tags_raw.split(",") if t.strip()]

        # Build JSON record
        rec = {
            "PromptID": int(row["PromptID"]) if pd.notnull(row["PromptID"]) else None,
            "PromptDate": str(row["PromptDate"]) if pd.notnull(row["PromptDate"]) else None,
            "HRTDays": int(row["HRTDays"]) if pd.notnull(row["HRTDays"]) else None,
            "Class": str(row["Class"]).strip() if pd.notnull(row["Class"]) else "",
            "Phase": str(row["Phase"]).strip() if pd.notnull(row["Phase"]) else "",
            "PromptText": str(row["PromptText"]).strip() if pd.notnull(row["PromptText"]) else "",
            "SourceFileID": int(row["SourceFileID"]) if pd.notnull(row["SourceFileID"]) else None,
            "Tags": tags,
            # Precomputed response path: /responses/n.html
            "ResponsePath": f"responses/{int(row['SourceFileID'])}.html" if pd.notnull(row["SourceFileID"]) else None
        }
        records.append(rec)

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(records)} records to {OUTPUT_JSON}")

if __name__ == "__main__":
    main()
