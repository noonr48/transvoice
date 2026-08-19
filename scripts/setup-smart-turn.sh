#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
RUNTIME_ROOT="${SMART_TURN_RUNTIME_ROOT:-${HOME}/.local/share/sloane/transvoice/smart-turn}"
VENV_DIR="${RUNTIME_ROOT}/venv"
MODEL_DIR="${RUNTIME_ROOT}/models"
MODEL_PATH="${MODEL_DIR}/smart-turn-v3.2-cpu.onnx"
MODEL_COMMIT="f766f81d3cfdf7737ac64aad813d91bbfd56bf93"
MODEL_SHA256="2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f"
MODEL_URL="https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/${MODEL_COMMIT}/smart-turn-v3.2-cpu.onnx"
REQUIREMENTS="${PROJECT_DIR}/services/smart-turn/requirements.txt"
WORKER="${PROJECT_DIR}/services/smart-turn/worker.py"
BOOTSTRAP_PYTHON="${SMART_TURN_BOOTSTRAP_PYTHON:-}"

if [[ -z "${BOOTSTRAP_PYTHON}" ]]; then
  BOOTSTRAP_PYTHON="$(command -v python3.12 || true)"
fi
if [[ -z "${BOOTSTRAP_PYTHON}" ]]; then
  printf 'Python 3.12 is required for the pinned Smart Turn runtime.\n' >&2
  exit 1
fi

bootstrap_version="$("${BOOTSTRAP_PYTHON}" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
if [[ "${bootstrap_version}" != "3.12" ]]; then
  printf 'Smart Turn requires Python 3.12; got %s from %s.\n' "${bootstrap_version}" "${BOOTSTRAP_PYTHON}" >&2
  exit 1
fi

mkdir -p -- "${RUNTIME_ROOT}" "${MODEL_DIR}"

if [[ -x "${VENV_DIR}/bin/python" ]]; then
  venv_version="$("${VENV_DIR}/bin/python" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  if [[ "${venv_version}" != "3.12" ]]; then
    incompatible_venv="${RUNTIME_ROOT}/venv.incompatible-python-${venv_version}"
    if [[ -e "${incompatible_venv}" ]]; then
      printf 'Refusing to overwrite preserved environment: %s\n' "${incompatible_venv}" >&2
      exit 1
    fi
    mv -- "${VENV_DIR}" "${incompatible_venv}"
  fi
fi

if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  "${BOOTSTRAP_PYTHON}" -m venv "${VENV_DIR}"
fi

"${VENV_DIR}/bin/python" -m pip install \
  --disable-pip-version-check \
  --requirement "${REQUIREMENTS}"

current_sha=""
if [[ -f "${MODEL_PATH}" ]]; then
  current_sha="$(sha256sum "${MODEL_PATH}" | awk '{print $1}')"
fi

if [[ "${current_sha}" != "${MODEL_SHA256}" ]]; then
  temp_model="$(mktemp "${MODEL_DIR}/smart-turn-v3.2-cpu.onnx.XXXXXX")"
  cleanup_temp() { [[ -f "${temp_model}" ]] && rm -f -- "${temp_model}"; }
  trap cleanup_temp EXIT
  curl --fail --location --retry 3 --output "${temp_model}" "${MODEL_URL}"
  printf '%s  %s\n' "${MODEL_SHA256}" "${temp_model}" | sha256sum --check --status
  chmod 0644 "${temp_model}"
  mv -- "${temp_model}" "${MODEL_PATH}"
  trap - EXIT
fi

printf '' | timeout 15 "${VENV_DIR}/bin/python" "${WORKER}" --model "${MODEL_PATH}" \
  | grep -q '"type":"ready"'

printf 'Smart Turn ready: %s\n' "${MODEL_PATH}"
