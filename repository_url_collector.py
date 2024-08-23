import shutil
import subprocess
from io import TextIOWrapper
from pathlib import Path
from typing import Union

OUTPUT_FILENAME = "repository_urls.txt"


def fetch_remote_url(repository_dir:Path) -> Union[str, None]:
    try:
        remote_url = (subprocess.check_output(["git", "config", "--get", "remote.origin.url"], cwd=repository_dir).decode().strip())
        return remote_url
    except subprocess.CalledProcessError:
        return None


def delete_repository(repository_dir:Path):
    delete_choice = input(f"Delete {repository_dir.name}? (y/n): ").strip().lower()
    if delete_choice == "y":
        shutil.rmtree(repository_dir)
        print(f"Deleted {repository_dir.name}.")
    else:
        print(f"Skipped {repository_dir.name}.")


def process_repository(repository_dir:Path, output_file:TextIOWrapper):
    if repository_dir.is_dir():
        remote_url = fetch_remote_url(repository_dir)
        if remote_url:
            output_file.write(f"{repository_dir.name}: {remote_url}\n")
        else:
            print(f"Error fetching URL for {repository_dir.name}. It may not be a git repository.")
        delete_repository(repository_dir)


def process_repositories(repositories_dir):
    repositories_dir = Path(repositories_dir)
    output_filepath = repositories_dir / OUTPUT_FILENAME

    with open(output_filepath, "w") as output_file:
        for repository_dir in repositories_dir.iterdir():
            process_repository(repository_dir, output_file)

    print(f"The URLs of the repositories have been saved to {output_filepath}.")


if __name__ == "__main__":
    repositories_dir = input("Enter the path to the directory containing your repositories: ")
    process_repositories(repositories_dir)
