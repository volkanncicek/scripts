import os
from pathlib import Path
import shutil

def delete_folders(start_path, folder_names):
    start_path = Path(start_path).resolve()

    for dirpath, dirnames, filenames in os.walk(start_path, topdown=False):
        for dirname in dirnames:
            if dirname.strip() in folder_names:
                folder_path = Path(dirpath) / dirname
                
                user_input = input(f"Do you want to delete {folder_path}? (yes/y to confirm) ").strip().lower()
                if user_input in ['yes', 'y']:
                    try:
                        shutil.rmtree(folder_path)
                        print(f"Deleted: {folder_path}\n")
                    except Exception as error:
                        print(f"Error deleting {folder_path}: {error}\n")
                else:
                    print(f"Skipped: {folder_path}")

if __name__ == "__main__":
    folder_names = [name.strip() for name in input("Enter the folder names to delete (comma separated): ").split(",")]
    start_path = input(f"Enter the start path for deleting {folder_names}: ").strip()

    delete_folders(start_path, folder_names)
