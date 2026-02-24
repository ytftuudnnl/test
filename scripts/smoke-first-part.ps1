$base = "http://127.0.0.1:3100"

function Invoke-Json($method, $path, $body = $null) {
  $uri = "$base$path"
  if ($null -eq $body) {
    return Invoke-RestMethod -Method $method -Uri $uri -ErrorAction Stop
  }
  $json = $body | ConvertTo-Json -Depth 6
  return Invoke-RestMethod -Method $method -Uri $uri -Body $json -ContentType "application/json" -ErrorAction Stop
}

Write-Host "[1] health"
$health = Invoke-Json GET "/health"
$health

Write-Host "[2] login"
$login = Invoke-Json POST "/api/auth/login" @{ username = "agent.demo"; password = "pass-1234" }
$login

Write-Host "[3] list customers"
$customers = Invoke-Json GET "/api/customers?page=1&pageSize=10"
$customers

Write-Host "[4] create customer"
$createdCustomer = Invoke-Json POST "/api/customers" @{
  name = "Smoke User"
  email = "smoke.user@example.com"
  tags = @("smoke")
  segments = @("trial")
}
$createdCustomer
$customerId = $createdCustomer.data.id

Write-Host "[5] create message"
$createdMessage = Invoke-Json POST "/api/messages" @{
  customerId = $customerId
  channel = "email"
  direction = "outbound"
  content = "Welcome message"
}
$createdMessage
$messageId = $createdMessage.data.id

Write-Host "[6] update message"
$updatedMessage = Invoke-Json PUT "/api/messages/$messageId" @{
  status = "processed"
  translatedContent = "欢迎消息"
}
$updatedMessage

Write-Host "[DONE] first-part smoke passed"
