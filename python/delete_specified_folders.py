import os
from pathlib import Path
import shutil
import argparse

def delete_folders(start_path, folder_names, auto_confirm=False, dry_run=False):
    start_path = Path(start_path).resolve()
    deleted = []
    skipped = []
    errors = []
    
    for dirpath, dirnames, _ in os.walk(start_path, topdown=False):
        for dirname in dirnames:
            if dirname.strip() in folder_names:
                folder_path = Path(dirpath) / dirname
                if dry_run:
                    print(f"[DRY-RUN] Would delete: {folder_path}")
                    skipped.append(str(folder_path) + " (dry-run)")
                    continue
                if auto_confirm:
                    user_input = 'y'
                else:
                    user_input = input(f"Do you want to delete {folder_path}? (yes/y to confirm) ").strip().lower()
                if user_input in ['yes', 'y']:
                    try:
                        shutil.rmtree(folder_path)
                        print(f"Deleted: {folder_path}")
                        deleted.append(str(folder_path))
                    except Exception as error:
                        print(f"Error deleting {folder_path}: {error}")
                        errors.append((str(folder_path), str(error)))
                else:
                    print(f"Skipped: {folder_path}")
                    skipped.append(str(folder_path))
    return deleted, skipped, errors

def main():
    parser = argparse.ArgumentParser(description="Delete specified folders recursively from a start path.")
    parser.add_argument('--folders', '-f', type=str, help='Comma separated folder names to delete.')
    parser.add_argument('--path', '-p', type=str, help='Start path for searching folders.')
    parser.add_argument('--yes', '-y', action='store_true', help='Auto-confirm deletion of all found folders.')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be deleted without deleting.')
    args = parser.parse_args()

    if args.folders:
        folder_names = [name.strip() for name in args.folders.split(",") if name.strip()]
    else:
        folder_names = [name.strip() for name in input("Enter the folder names to delete (comma separated): ").split(",") if name.strip()]
    if not folder_names:
        print("No folder names provided. Exiting.")
        return
    if args.path:
        start_path = args.path.strip()
    else:
        start_path = input(f"Enter the start path for deleting {folder_names}: ").strip()
    if not start_path:
        print("No start path provided. Exiting.")
        return
    if not Path(start_path).exists():
        print(f"Start path does not exist: {start_path}")
        return

    deleted, skipped, errors = delete_folders(start_path, folder_names, auto_confirm=args.yes, dry_run=args.dry_run)

    print("\nSummary:")
    print(f"Deleted: {len(deleted)}")
    for d in deleted:
        print(f"  {d}")
    print(f"Skipped: {len(skipped)}")
    for s in skipped:
        print(f"  {s}")
    if errors:
        print(f"Errors: {len(errors)}")
        for path, err in errors:
            print(f"  {path}: {err}")

if __name__ == "__main__":
    main()
